import { Request, Response } from 'express';
import dojahService from '../services/dojahService';
import { AppDataSource } from '../database';
import { KycVerification } from '../entities/KycVerification';
import { User } from '../entities/User';

const kycRepo = AppDataSource.getRepository(KycVerification);


class KYCController {
  async verifyKYC(req: Request, res: Response) {
    const { userId, kycData } = req.body;
    const userRepo = AppDataSource.getRepository(User);

    try {
      const verification = kycRepo.create({
        userId,
        type: 'PHOTOID_SELFIE',
        status: 'PENDING',
      });
      await kycRepo.save(verification);

      const result = await dojahService.verifyPhotoIdWithSelfie(
        kycData.selfie,
        kycData.governmentId.frontImage
      );

      const confidence = result?.entity?.selfie?.confidence_value || 0;
      const match = result?.entity?.selfie?.match || false;

      verification.confidence = confidence;
      verification.status = match && confidence >= 90 ? 'PASSED' : 'FAILED';
      verification.metadata = result;

      await kycRepo.save(verification);

      // Update user if passed
      if (verification.status === 'PASSED') {
        const user = await userRepo.findOne({ where: { id: userId } });
        if (user) {
          user.isKYCVerified = true;
          await userRepo.save(user);
        }
      }

      res.status(200).json(verification);
    } catch (error: any) {
      res.status(500).json({ message: 'Error verifying KYC', error: error.message });
    }
  }

  async webhook(req: Request, res: Response) {
    const { event, data } = req.body;
    const userRepo = AppDataSource.getRepository(User);

    try {
      const verification = await kycRepo.findOne({ where: { userId: data.userId } });
      if (verification) {
        verification.confidence = data?.confidence_value;
        verification.status =
          data?.match && data?.confidence_value >= 90 ? 'PASSED' : 'FAILED';
        verification.metadata = data;
        await kycRepo.save(verification);

        // Update user if passed
        if (verification.status === 'PASSED') {
          const user = await userRepo.findOne({ where: { id: data.userId } });
          if (user) {
            user.isKYCVerified = true;
            await userRepo.save(user);
          }
        }
      }

      res.status(200).json({ received: true });
    } catch (error: any) {
      res.status(500).json({ message: 'Webhook error', error: error.message });
    }
  }
}

export default new KYCController();