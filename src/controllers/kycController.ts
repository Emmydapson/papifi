import { Request, Response } from 'express';
import { AppDataSource } from '../database';
import { KycType, KycVerification } from '../entities/KycVerification';
import { User } from '../entities/User';
import { isMapleradProviderError, mapleradErrorToHttpStatus, MapleRadService } from '../services/mapleradService';
import { auditService } from '../services/auditService';
import { logger } from '../services/logger';

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

const redactBvn = (bvn: string) => ({
  last4: bvn.slice(-4),
  length: bvn.length,
});

const sanitizeProviderResponse = (value: any): any => {
  if (Array.isArray(value)) return value.map(sanitizeProviderResponse);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key.toLowerCase().includes('bvn') ? '[redacted]' : sanitizeProviderResponse(entry),
    ])
  );
};

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

  async verifyBvn(req: Request, res: Response) {
    const userId = req.user?.id;
    const { bvn } = req.body;

    if (!userId) return res.status(401).json({ message: 'Unauthorized. User not authenticated.' });
    if (!bvn || !/^\d{11}$/.test(String(bvn))) {
      return res.status(400).json({ message: 'A valid 11-digit BVN is required.' });
    }

    try {
      const providerResponse = await getMapleRadService().verifyBvn(String(bvn));
      const providerStatus = String(providerResponse?.status || providerResponse?.verification_status || '').toLowerCase();
      const passed = Boolean(
        providerResponse?.id ||
        providerResponse?.bvn ||
        ['success', 'successful', 'verified', 'valid'].includes(providerStatus)
      );

      if (!passed) {
        logger.warn('maplerad_bvn_verification_not_confirmed', {
          operation: 'maplerad.identity.verify_bvn',
          userId,
          providerStatus: providerResponse?.status || providerResponse?.verification_status,
          providerMessage: providerResponse?.message,
        });
      }

      const verification = kycRepo.create({
        user: { id: userId } as User,
        userId,
        type: 'BVN',
        status: passed ? 'PASSED' : 'FAILED',
        metadata: {
          provider: 'maplerad',
          bvn: redactBvn(String(bvn)),
          providerResponse: sanitizeProviderResponse(providerResponse),
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
        status: verification.status,
      });
    } catch (error: any) {
      if (isMapleradProviderError(error)) {
        return res.status(mapleradErrorToHttpStatus(error)).json({
          message: 'Unable to verify BVN with Maplerad.',
          code: error.code,
          providerStatus: error.providerStatus,
          providerMessage: error.providerMessage || 'Maplerad rejected the BVN verification request.',
          requestId: error.requestId,
        });
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
      userId,
      verifications: verifications.map((verification) => ({
        id: verification.id,
        type: verification.type,
        status: verification.status,
        metadata: verification.metadata,
        createdAt: verification.createdAt,
      })),
    });
  }
}

export default new KYCController();
