import { Router } from 'express';
import KYCController from '../controllers/kycController';

const router = Router();

router.post('/kyc/start', KYCController.startVerification);
router.get('/kyc/:userId', KYCController.getUserKYCStatus);
router.post('/', KYCController.webhook); // webhook from Dojah

export default router;
