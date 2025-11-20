import { Router } from 'express';
import KYCController from '../controllers/kycController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.post('/kyc/start', authMiddleware, KYCController.startVerification);
router.get('/kyc/status', authMiddleware, KYCController.getUserKYCStatus);
router.post('/', KYCController.webhook); // webhook from Dojah

export default router;
