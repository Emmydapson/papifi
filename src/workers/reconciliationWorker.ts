import { reconciliationService } from '../services/reconciliationService';
import { logger } from '../services/logger';

let timer: NodeJS.Timeout | undefined;

export const startReconciliationWorker = () => {
  const enabled = process.env.RECONCILIATION_WORKER_ENABLED === 'true';
  if (!enabled) {
    logger.info('reconciliation_worker_disabled');
    return;
  }

  const intervalMs = Number(process.env.RECONCILIATION_WORKER_INTERVAL_MS || 5 * 60 * 1000);
  const thresholdMinutes = Number(process.env.RECONCILIATION_STALE_MINUTES || 30);
  if (!Number.isFinite(intervalMs) || intervalMs < 30000) {
    throw new Error('RECONCILIATION_WORKER_INTERVAL_MS must be at least 30000');
  }

  const run = async () => {
    try {
      await reconciliationService.reconcileStaleTransactions(thresholdMinutes);
    } catch (error) {
      logger.error('reconciliation_worker_failed', error);
    }
  };

  timer = setInterval(run, intervalMs);
  timer.unref();
  logger.info('reconciliation_worker_started', { intervalMs, thresholdMinutes });
};

export const stopReconciliationWorker = () => {
  if (timer) clearInterval(timer);
  timer = undefined;
};
