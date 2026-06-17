/* ---------------------------------------------
FILE: src/routes/walletRoutes.ts
--------------------------------------------- */

import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import walletController, { mapleradWebhookHandler } from '../controllers/walletController';
import { moneyMovementRateLimit } from '../middlewares/rateLimitMiddleware';

const router = Router();

router.post('/wallet/webhook', mapleradWebhookHandler);
router.use('/wallet', authMiddleware, moneyMovementRateLimit, walletController);

export default router;
