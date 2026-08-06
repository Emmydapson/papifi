import { walletProvisioningService } from '../services/walletProvisioningService';
import { logger } from '../services/logger';

export const startWalletProvisioningWorker = () => {
  const intervalMs = Math.max(5000, Number(process.env.WALLET_PROVISIONING_WORKER_INTERVAL_MS || 30000));
  const run = async () => {
    try {
      await walletProvisioningService.processDueJobs(Number(process.env.WALLET_PROVISIONING_WORKER_BATCH_SIZE || 10));
    } catch (error) {
      logger.error('wallet_provisioning_worker_failed', error);
    }
  };
  setInterval(run, intervalMs).unref();
  void run();
};
