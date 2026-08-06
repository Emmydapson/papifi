import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { adminMiddleware } from '../middlewares/adminMiddleware';
import {
  getUserWalletSummary,
  getWalletProvisioningJob,
  listWalletProvisioningJobs,
  listAuditLogs,
  listReconciliationQueue,
  listRiskFlags,
  markWalletProvisioningManualReview,
  markTransactionManualReview,
  retryWalletProvisioningJob,
} from '../controllers/adminController';

const router = Router();

router.use(authMiddleware, adminMiddleware);
router.get('/audit-logs', listAuditLogs);
router.get('/risk-flags', listRiskFlags);
router.get('/reconciliation', listReconciliationQueue);
router.post('/transactions/:id/manual-review', markTransactionManualReview);
router.get('/users/:userId/wallet-summary', getUserWalletSummary);
router.get('/wallet-provisioning', listWalletProvisioningJobs);
router.get('/wallet-provisioning/:id', getWalletProvisioningJob);
router.post('/wallet-provisioning/:id/retry', retryWalletProvisioningJob);
router.post('/wallet-provisioning/:id/mark-manual-review', markWalletProvisioningManualReview);

export default router;
