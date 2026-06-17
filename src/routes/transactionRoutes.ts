import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import  transactionController from '../controllers/transactionController';
import { moneyMovementRateLimit } from '../middlewares/rateLimitMiddleware';

const router = Router();

// Mount all routes from walletController under /wallet
// Apply authMiddleware to all routes
router.use('/transaction', authMiddleware, moneyMovementRateLimit, transactionController);

export default router;
