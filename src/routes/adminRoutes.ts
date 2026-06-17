import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { adminMiddleware } from '../middlewares/adminMiddleware';
import {
  getUserWalletSummary,
  listAuditLogs,
  listReconciliationQueue,
  listRiskFlags,
  markTransactionManualReview,
} from '../controllers/adminController';

const router = Router();

router.use(authMiddleware, adminMiddleware);
router.get('/audit-logs', listAuditLogs);
router.get('/risk-flags', listRiskFlags);
router.get('/reconciliation', listReconciliationQueue);
router.post('/transactions/:id/manual-review', markTransactionManualReview);
router.get('/users/:userId/wallet-summary', getUserWalletSummary);

export default router;
