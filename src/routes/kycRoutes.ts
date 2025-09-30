import { Router } from 'express';
import KYCController from '../controllers/kycController';

const router = Router();

router.post('/kyc/verify', KYCController.verifyKYC);
router.post('/kyc', KYCController.webhook); // webhook endpoint for Dojah

export default router;
