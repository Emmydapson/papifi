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
import {
  bvnFailureMetadata,
  bvnFingerprint,
  bvnProviderErrorMetadata,
  bvnSuccessMetadata,
  normalizeBvnInput,
  providerErrorAttemptOutcome,
  serializeKycStatus,
} from '../services/kycService';

let mapleRadServiceInstance: MapleRadService | undefined;
const getMapleRadService = () => (mapleRadServiceInstance ??= new MapleRadService());
const kycRepo = AppDataSource.getRepository(KycVerification);
const userRepo = AppDataSource.getRepository(User);

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
        return res.status(200).json({
          message: 'BVN verification passed.',
          code: 'BVN_VERIFIED',
          status: 'PASSED',
          verificationId: existingPassed.id,
          reused: true,
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

      if (passed) {
        await userRepo.update({ id: userId }, { isKYCVerified: true, accountTier: 'BVN_VERIFIED' });
      }
      await auditService.log({
        actorUserId: userId,
        targetUserId: userId,
        action: 'KYC_BVN_VERIFICATION',
        entityType: 'KycVerification',
        entityId: verification.id,
        metadata: { status: verification.status },
        req,
      });

      return res.status(200).json({
        message: passed ? 'BVN verification passed.' : 'BVN verification failed.',
        code: providerResult.applicationCode,
        status: verification.status,
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
