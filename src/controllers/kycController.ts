import { Request, Response } from 'express';
import dojahService from '../services/dojahService';
import { AppDataSource } from '../database';
import { KycVerification } from '../entities/KycVerification';

const kycRepo = AppDataSource.getRepository(KycVerification);

class KYCController {
  // User submits KYC
  async verifyKYC(req: Request, res: Response) {
    const { userId, kycData } = req.body;

    try {
      // Create DB record as PENDING
      const verification = kycRepo.create({
        userId,
        type: 'PHOTOID_SELFIE', // or 'NIN_SELFIE' depending on request
        status: 'PENDING',
      });
      await kycRepo.save(verification);

      // Call Dojah
      const result = await dojahService.verifyPhotoIdWithSelfie(
        kycData.selfie,
        kycData.governmentId.frontImage
      );

      // Extract confidence & status
      const confidence = result?.entity?.selfie?.confidence_value || 0;
      const match = result?.entity?.selfie?.match || false;

      verification.confidence = confidence;
      verification.status = match && confidence >= 90 ? 'PASSED' : 'FAILED';
      verification.metadata = result;

      await kycRepo.save(verification);

      res.status(200).json(verification);
    } catch (error: any) {
      res.status(500).json({ message: 'Error verifying KYC', error: error.message });
    }
  }

  // Webhook from Dojah
  async webhook(req: Request, res: Response) {
    try {
      const { event, data } = req.body;

      // Example: data should include userId you attached earlier
      const verification = await kycRepo.findOne({ where: { userId: data.userId } });
      if (verification) {
        verification.confidence = data?.confidence_value;
        verification.status = data?.match && data?.confidence_value >= 90 ? 'PASSED' : 'FAILED';
        verification.metadata = data;
        await kycRepo.save(verification);
      }

      res.status(200).json({ received: true });
    } catch (error: any) {
      res.status(500).json({ message: 'Webhook error', error: error.message });
    }
  }
}

export default new KYCController();
