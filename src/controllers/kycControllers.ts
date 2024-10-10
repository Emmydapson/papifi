// kycController.ts
import { Request, Response } from 'express';
import payshigaService from '../services/walletService'; // Ensure correct service path
import { KYCData } from '../../types/kyc'; // Adjust import path if needed

class KYCController {
  async verifyKYC(req: Request, res: Response) {
    const { userId, kycData }: { userId: string; kycData: KYCData } = req.body;

    try {
      const kycResult = await payshigaService.verifyKYC(userId, kycData);
      res.status(200).json(kycResult);
    } catch (error: unknown) {
      // Type-safe error handling
      if (error instanceof Error) {
        res.status(500).json({ message: 'Error verifying KYC', error: error.message });
      } else {
        res.status(500).json({ message: 'Unknown error occurred during KYC verification' });
      }
    }
  }
}

export default new KYCController();
