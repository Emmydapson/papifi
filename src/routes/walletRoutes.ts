/* ---------------------------------------------
FILE: src/routes/walletRoutes.ts
--------------------------------------------- */

import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import walletController from '../controllers/walletController';

const router = Router();

// Mount all routes from walletController under /wallet
// Apply authMiddleware to all routes
router.use('/wallet', authMiddleware, walletController);

export default router;
