import { Request, Response } from 'express';
import { AppDataSource } from '../database';
import { KycVerification } from '../entities/KycVerification';
import { User } from '../entities/User';

const kycRepo = AppDataSource.getRepository(KycVerification);
const userRepo = AppDataSource.getRepository(User);

class KYCController {
  // Frontend calls this when user starts verification
  async startVerification(req: Request, res: Response) {
    const { userId, type } = req.body;

    try {
      const verification = kycRepo.create({
        userId,
        type,
        status: 'PENDING',
      });

      await kycRepo.save(verification);

      res.status(201).json({ message: 'Verification started', verification });
    } catch (error: any) {
      res.status(500).json({ message: 'Error starting KYC', error: error.message });
    }
  }

  // Webhook Dojah will call -> https://api.papifi.com/kyc
  async webhook(req: Request, res: Response) {
    const { data } = req.body;

    try {
      const verification = await kycRepo.findOne({ where: { userId: data.userId } });

      if (verification) {
        verification.confidence = data?.confidence_value;
        verification.status =
          data?.match && data?.confidence_value >= 90 ? 'PASSED' : 'FAILED';
        verification.metadata = data;

        await kycRepo.save(verification);

        // Update user record if passed
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

  // For frontend to fetch user’s latest KYC status
  async getUserKYCStatus(req: Request, res: Response) {
    const { userId } = req.params;

    try {
      const verification = await kycRepo.findOne({
        where: { userId },
        order: { createdAt: 'DESC' },
      });

      if (!verification) {
        return res.status(404).json({ message: 'No KYC found for user' });
      }

      res.status(200).json(verification);
    } catch (error: any) {
      res.status(500).json({ message: 'Error fetching KYC', error: error.message });
    }
  }
}

export default new KYCController();
