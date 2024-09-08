// src/routes/walletRoutes.ts
import { Router } from 'express';
import { createWalletController } from '../controllers/walletController';

const router = Router();

// Route to create a new wallet
router.post('/create', createWalletController);

export default router;
