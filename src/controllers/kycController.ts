// src/controllers/KYCController.ts
import { Request, Response } from 'express';
import { AppDataSource } from '../database';
import { KycVerification } from '../entities/KycVerification';
import { User } from '../entities/User';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

const kycRepo = AppDataSource.getRepository(KycVerification);
const userRepo = AppDataSource.getRepository(User);

class KYCController {
  /**
   * Called by frontend to start a KYC attempt.
   * We create a verification record and return a referenceId.
   */
  async startVerification(req: Request, res: Response) {
  const { type } = req.body;
  
  // Get userId from JWT (populated by authMiddleware)
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized. User not authenticated.' });
  }

  try {
    const referenceId = `kyc_${userId}_${uuidv4()}`;

    const verification = kycRepo.create({
      user: { id: userId } as User, // relation
      type,
      status: 'PENDING',
      metadata: { referenceId },
    });

    await kycRepo.save(verification);

    res.status(201).json({
      message: 'Verification started',
      referenceId,
      verification,
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Error starting KYC',
      error: error.message,
    });
  }
}

  /**
   * Webhook endpoint Dojah calls when verification is updated.
   * URL: https://api.papifi.com/kyc
   */
  async webhook(req: Request, res: Response) {
  try {
    const payload = req.body;
    const signature = req.headers['x-dojah-signature'] as string;
    const secret = process.env.DOJAH_SECRET_KEY!;

    // ✅ Verify signature
    const expected = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    if (signature !== expected) {
      return res.status(401).json({ message: 'Invalid signature' });
    }

    console.log('✅ Verified Dojah webhook:', payload);

    const referenceId =
      payload.reference_id || payload.referenceId || payload?.data?.reference_id;
    if (!referenceId) {
      return res.status(400).json({ message: 'No referenceId in payload' });
    }

    // Find verification record
    const verification = await kycRepo.findOne({
      where: { metadata: { referenceId } },
    });

    if (!verification) {
      return res.status(404).json({ message: 'Verification record not found' });
    }

    // Map statuses
    const dojahStatus = payload.verification_status || payload.status;
    let normalizedStatus: 'PENDING' | 'PASSED' | 'FAILED' = 'PENDING';

    switch (dojahStatus) {
      case 'Completed':
        normalizedStatus = 'PASSED';
        break;
      case 'Failed':
        normalizedStatus = 'FAILED';
        break;
      default:
        normalizedStatus = 'PENDING';
    }

    // Extract only useful fields from payload
    const cleanedMetadata = {
      referenceId,
      verificationUrl: payload.verification_url,
      verificationType: payload.verification_type,
      verificationMode: payload.verification_mode,
      idType: payload.id_type,
      idUrl: payload.id_url,
      backUrl: payload.back_url,
      selfieUrl: payload.selfie_url,
      firstName: payload.data?.user_data?.data?.first_name,
      lastName: payload.data?.user_data?.data?.last_name,
      dob: payload.data?.user_data?.data?.dob,
      phone: payload.data?.phone_number?.data?.phone,
      email: payload.data?.email?.data?.email,
      bvn: payload.data?.government_data?.data?.bvn?.entity?.bvn,
      nin: payload.data?.government_data?.data?.nin?.entity?.nin,
      businessName: payload.data?.business_id?.business_name,
      businessNumber: payload.data?.business_id?.business_number,
    };

    // Update verification record
    verification.status = normalizedStatus;
    verification.confidence = payload.confidence_value ?? null;
    verification.metadata = cleanedMetadata;

    await kycRepo.save(verification);

    // If KYC passed → mark user verified
    if (normalizedStatus === 'PASSED') {
      const user = await userRepo.findOne({ where: { id: verification.userId } });
      if (user) {
        user.isKYCVerified = true;
        await userRepo.save(user);
      }
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(500).json({ message: 'Webhook error', error: error.message });
  }
}

  /**
   * Fetch the latest KYC status for a user
   * GET /kyc/:userId
   */
  async getUserKYCStatus(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized. User not authenticated.' });
  }

  try {
    const verification = await kycRepo.findOne({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
    });

    if (!verification) {
      return res.status(404).json({ message: 'No KYC record found' });
    }

    res.status(200).json({
      userId,
      status: verification.status,
      type: verification.type,
      confidence: verification.confidence,
      metadata: verification.metadata,
      createdAt: verification.createdAt,
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Error fetching KYC status',
      error: error.message,
    });
  }
}
}

export default new KYCController();
