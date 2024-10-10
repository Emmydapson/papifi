import { Router } from 'express';
import payshigaController from '../controllers/walletController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.post('/wallet', authMiddleware, payshigaController.createWallet);
router.post('/send', authMiddleware, payshigaController.sendMoney);
router.post('/receive', authMiddleware, payshigaController.receiveMoney);
router.post('/convert', authMiddleware, payshigaController.convertCurrency);
router.post('/virtual-card',authMiddleware,  payshigaController.createVirtualCard);
router.put('/cards/lock', authMiddleware, payshigaController.lockVirtualCard);

export default router;
