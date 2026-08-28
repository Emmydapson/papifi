import { NextFunction, Request, Response } from 'express';
import { AppDataSource } from '../database';
import { KycType, KycVerification } from '../entities/KycVerification';
import { User } from '../entities/User';
import {
  isMapleradProviderError,
  mapleradErrorToApplicationCode,
  MapleRadService,
} from '../services/mapleradService';
import { auditService } from '../services/auditService';
import { logger } from '../services/logger';
import { walletProvisioningService } from '../services/walletProvisioningService';
import {
  bvnFailureMetadata,
  bvnFingerprint,
  bvnProviderErrorMetadata,
  bvnSuccessMetadata,
  accountTierForTier1State,
  normalizeBvnInput,
  providerErrorAttemptOutcome,
  serializeKycStatus,
  walletStateForTier1State,
} from '../services/kycService';

let mapleRadServiceInstance: MapleRadService | undefined;
const getMapleRadService = () => (mapleRadServiceInstance ??= new MapleRadService());
const kycRepo = AppDataSource.getRepository(KycVerification);
const userRepo = AppDataSource.getRepository(User);

const tier1Response = (result: Awaited<ReturnType<MapleRadService['enrollMapleradCustomerTier1']>>) => ({
  state: result.state,
  mapleradCustomerTier: result.tier1 ? 'TIER_1' : undefined,
  code: result.code,
  missingFields: result.state === 'PROFILE_INCOMPLETE' ? result.missingFields || [] : undefined,
  providerStatus: result.state === 'FAILED' || result.state === 'RETRYING' ? result.providerStatus : undefined,
  requestId: result.state === 'FAILED' || result.state === 'RETRYING' ? result.requestId : undefined,
});

const walletResponse = (state: string) => ({
  currency: 'NGN',
  state,
});

const documentTypes: KycType[] = [
  'NIN',
  'DRIVERS_LICENSE',
  'INTERNATIONAL_PASSPORT',
  'VOTERS_CARD',
];

class KYCController {
  async startVerification(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized. User not authenticated.' });

    return res.status(200).json({
      message: 'KYC can be completed with Maplerad BVN verification and document metadata submission.',
      provider: 'maplerad',
      documentTypes,
    });
  }

  async verifyBvn(req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.id;
    const { bvn } = req.body;

    if (!userId) return res.status(401).json({ message: 'Unauthorized. User not authenticated.' });
    const normalizedBvn = normalizeBvnInput(bvn);
    if (!normalizedBvn.ok) {
      return res.status(400).json({ message: normalizedBvn.message });
    }

    try {
      const fingerprint = bvnFingerprint(normalizedBvn.value);
      const existingPassed = await kycRepo.findOne({
        where: {
          userId,
          type: 'BVN',
          status: 'PASSED',
          bvnFingerprint: fingerprint,
        },
        order: { createdAt: 'DESC' },
      });
      if (existingPassed) {
        const tier1Result = await getMapleRadService().enrollMapleradCustomerTier1(
          userId,
          undefined,
          {
            bvn: normalizedBvn.value,
            dateOfBirth: req.body.dateOfBirth,
            phoneNumber: req.body.phoneNumber,
            address: req.body.address,
            city: req.body.city,
            state: req.body.state,
            country: req.body.country,
            postalCode: req.body.postalCode,
            postal_code: req.body.postal_code,
            photo: req.body.photo,
          }
        );
        const accountTier = accountTierForTier1State(tier1Result.state);
        await userRepo.update({ id: userId }, { isKYCVerified: true, accountTier });
        const walletProvisioningResult = tier1Result.tier1
          ? await walletProvisioningService.provisionDefaultNgnWallet(userId, {
              processNow: true,
              actorUserId: userId,
            })
          : undefined;
        return res.status(200).json({
          message: tier1Result.state === 'PROFILE_INCOMPLETE'
            ? 'BVN verified successfully, but additional profile information is required to complete Tier 1 KYC.'
            : 'BVN verified successfully.',
          code: 'BVN_VERIFIED',
          status: 'PASSED',
          accountTier,
          verificationId: existingPassed.id,
          reused: true,
          tier1Enrollment: tier1Response(tier1Result),
          walletProvisioning: {
            currency: 'NGN',
            state: walletProvisioningResult?.job.state || walletStateForTier1State(tier1Result.state),
          },
        });
      }

      const service = getMapleRadService();
      const providerResult = await service.verifyBvn(normalizedBvn.value);
      const passed = providerResult.verified;

      if (!passed) {
        logger.warn('maplerad_bvn_verification_not_confirmed', {
          operation: 'maplerad.identity.verify_bvn',
          userId,
          providerEnvironment: providerResult.providerEnvironment,
          providerHttpStatus: providerResult.providerHttpStatus,
          providerRequestId: providerResult.providerRequestId,
          providerStatus: providerResult.providerStatus,
          providerCode: providerResult.providerCode,
          providerMessage: providerResult.providerMessage,
          responseKeys: providerResult.responseKeys,
          dataKeys: providerResult.dataKeys,
        });
      }

      const verification = kycRepo.create({
        user: { id: userId } as User,
        userId,
        type: 'BVN',
        status: passed ? 'PASSED' : 'FAILED',
        bvnFingerprint: fingerprint,
        attemptOutcome: passed ? 'VERIFIED' : 'PROVIDER_REJECTED',
        metadata: {
          ...(passed
            ? bvnSuccessMetadata(normalizedBvn.redacted, providerResult)
            : bvnFailureMetadata(normalizedBvn.redacted, providerResult)),
        },
      });
      await kycRepo.save(verification);
      await auditService.log({
        actorUserId: userId,
        targetUserId: userId,
        action: 'KYC_BVN_VERIFICATION',
        entityType: 'KycVerification',
        entityId: verification.id,
        metadata: { status: verification.status },
        req,
      });

      let tier1Result: Awaited<ReturnType<MapleRadService['enrollMapleradCustomerTier1']>> | undefined;
      if (passed) {
        await userRepo.update({ id: userId }, { isKYCVerified: true, accountTier: 'BVN_VERIFIED' });
        tier1Result = await service.enrollMapleradCustomerTier1(
          userId,
          undefined,
          {
            bvn: normalizedBvn.value,
            dateOfBirth: req.body.dateOfBirth,
            phoneNumber: req.body.phoneNumber,
            address: req.body.address,
            city: req.body.city,
            state: req.body.state,
            country: req.body.country,
            postalCode: req.body.postalCode,
            postal_code: req.body.postal_code,
            photo: req.body.photo,
          },
          providerResult.identity
        );
        verification.metadata = {
          ...(verification.metadata || {}),
          mapleradCustomerId: tier1Result.customerId,
          mapleradTier1EnrollmentState: tier1Result.state,
        };
        await kycRepo.save(verification);
        await userRepo.update({ id: userId }, { accountTier: accountTierForTier1State(tier1Result.state) });
      }

      const walletProvisioningResult = passed
        && tier1Result?.tier1
        ? await walletProvisioningService.provisionDefaultNgnWallet(userId, {
            processNow: true,
            actorUserId: userId,
          })
        : undefined;

      return res.status(200).json({
        message: passed && tier1Result?.state === 'PROFILE_INCOMPLETE'
          ? 'BVN verified successfully, but additional profile information is required to complete Tier 1 KYC.'
          : passed
          ? 'BVN verified successfully.'
          : 'BVN verification failed.',
        code: providerResult.applicationCode,
        status: verification.status,
        accountTier: passed ? accountTierForTier1State(tier1Result?.state) : undefined,
        tier1Enrollment: tier1Result ? tier1Response(tier1Result) : undefined,
        walletProvisioning: passed
          ? walletResponse(walletProvisioningResult?.job.state || walletStateForTier1State(tier1Result?.state || 'NOT_STARTED'))
          : undefined,
      });
    } catch (error: any) {
      if (isMapleradProviderError(error)) {
        const code = mapleradErrorToApplicationCode(error);
        const safeAttempt = kycRepo.create({
          user: { id: userId } as User,
          userId,
          type: 'BVN',
          status: 'PENDING',
          bvnFingerprint: normalizedBvn.ok ? bvnFingerprint(normalizedBvn.value) : undefined,
          attemptOutcome: providerErrorAttemptOutcome(code),
          metadata: bvnProviderErrorMetadata(normalizedBvn.ok ? normalizedBvn.redacted : { last4: '', length: 0 }, {
            providerEnvironment: getMapleRadService().getEnvironment(),
            providerHttpStatus: error.providerStatus,
            providerRequestId: error.requestId,
            providerErrorCode: error.code,
            providerMessage: error.providerMessage,
          }),
        });
        await kycRepo.save(safeAttempt);
        logger.warn('maplerad_bvn_verification_provider_error', {
          operation: error.operation,
          userId,
          providerEnvironment: getMapleRadService().getEnvironment(),
          providerHttpStatus: error.providerStatus,
          providerRequestId: error.requestId,
          providerCode: error.code,
          providerMessage: error.providerMessage,
          applicationCode: code,
        });

        return next(error);
      }

      return res.status(502).json({
        message: 'Unable to verify BVN with Maplerad.',
        error: 'provider_error',
      });
    }
  }

  async submitDocumentMetadata(req: Request, res: Response) {
    const userId = req.user?.id;
    const { documentType, documentNumber, frontImageUrl, backImageUrl, selfieImageUrl, issuedCountry, expiresAt } =
      req.body;

    if (!userId) return res.status(401).json({ message: 'Unauthorized. User not authenticated.' });
    if (!documentTypes.includes(documentType)) {
      return res.status(400).json({ message: 'Unsupported KYC document type.' });
    }

    const verification = kycRepo.create({
      user: { id: userId } as User,
      userId,
      type: documentType,
      status: 'PENDING',
      metadata: {
        documentType,
        documentNumber,
        frontImageUrl,
        backImageUrl,
        selfieImageUrl,
        issuedCountry,
        expiresAt,
        verificationProvider: null,
        note: 'Document metadata collected for compliance records. Automated document verification is not enabled in Phase 1.',
      },
    });

    await kycRepo.save(verification);
    await userRepo.update({ id: userId }, { accountTier: 'DOCUMENT_SUBMITTED' });
    await auditService.log({
      actorUserId: userId,
      targetUserId: userId,
      action: 'KYC_DOCUMENT_SUBMITTED',
      entityType: 'KycVerification',
      entityId: verification.id,
      metadata: { documentType },
      req,
    });

    return res.status(201).json({
      message: 'KYC document metadata submitted.',
      verificationId: verification.id,
      status: verification.status,
    });
  }

  async getUserKYCStatus(req: Request, res: Response) {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized. User not authenticated.' });

    const verifications = await kycRepo.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
    });

    return res.status(200).json({
      ...serializeKycStatus(userId, verifications),
    });
  }
}

export default new KYCController();
