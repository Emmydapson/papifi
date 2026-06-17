import { Router } from 'express';
import KYCController from '../controllers/kycController';
import { authMiddleware } from '../middlewares/authMiddleware';


const router = Router();

router.post('/start', authMiddleware, KYCController.startVerification);
router.post('/bvn', authMiddleware, KYCController.verifyBvn);
router.post('/documents', authMiddleware, KYCController.submitDocumentMetadata);
router.get('/status', authMiddleware, KYCController.getUserKYCStatus);

export default router;
