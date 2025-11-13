import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import  transactionController from '../controllers/transactionController';

const router = Router();

// Mount all routes from walletController under /wallet
// Apply authMiddleware to all routes
router.use('/transaction', authMiddleware, transactionController);

export default router;