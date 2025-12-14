import express, { Router, Request, Response } from 'express';
import KYCController from '../controllers/kycController';
import { authMiddleware } from '../middlewares/authMiddleware';


const router = Router();

router.post('/start', authMiddleware, KYCController.startVerification);
router.get('/status', authMiddleware, KYCController.getUserKYCStatus);
router.post(
  '/',
  express.json({
    verify: (req: Request & { rawBody?: string }, res: Response, buf: Buffer) => {
      req.rawBody = buf.toString();
    },
  }),
  KYCController.webhook
);


export default router;
