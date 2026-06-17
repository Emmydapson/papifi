import { LessThan } from 'typeorm';
import { AppDataSource } from '../database';
import { Transaction } from '../entities/Transaction';
import { ledgerService } from './ledgerService';
import { MapleRadService } from './mapleradService';
import { auditService } from './auditService';
import { logger } from './logger';

const mapleradService = new MapleRadService();

export class ReconciliationService {
  private running = false;

  async findStaleProviderTransactions(thresholdMinutes = Number(process.env.RECONCILIATION_STALE_MINUTES || 30)) {
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    return AppDataSource.getRepository(Transaction).find({
      where: [
        { status: 'PROCESSING', provider: 'maplerad', createdAt: LessThan(cutoff) },
        { status: 'PENDING', provider: 'maplerad', createdAt: LessThan(cutoff) },
      ],
      order: { createdAt: 'ASC' },
      take: 100,
    });
  }

  async reconcileTransaction(transaction: Transaction) {
    const repo = AppDataSource.getRepository(Transaction);
    if (!transaction.providerReference) {
      transaction.reconciliationStatus = 'MANUAL_REVIEW';
      transaction.reconciliationNotes = 'Missing provider reference';
      transaction.lastCheckedAt = new Date();
      return repo.save(transaction);
    }

    const status = await mapleradService.getProviderTransactionStatus(transaction.providerReference);
    transaction.lastCheckedAt = new Date();

    if (!status) {
      transaction.reconciliationStatus = 'PENDING';
      transaction.reconciliationNotes = 'Provider status endpoint unavailable or returned no result';
      return repo.save(transaction);
    }

    const providerStatus = String(status.status || '').toLowerCase();
    if (['success', 'successful', 'completed'].includes(providerStatus)) {
      if (!['SUCCESS', 'FAILED', 'REVERSED'].includes(transaction.status)) {
        await ledgerService.markExternalSuccess(transaction.id, transaction.providerReference, status.status, {
          id: status.id,
          reference: transaction.providerReference,
          status: status.status,
        });
      }
      const refreshed = await repo.findOneOrFail({ where: { id: transaction.id } });
      if (['FAILED', 'REVERSED'].includes(refreshed.status)) {
        refreshed.reconciliationStatus = 'MISMATCHED';
        refreshed.reconciliationNotes = `Provider reported ${status.status} for terminal ${refreshed.status} transaction`;
        refreshed.lastCheckedAt = new Date();
        await auditService.log({
          action: 'RECONCILIATION_MISMATCHED',
          entityType: 'Transaction',
          entityId: refreshed.id,
          metadata: { providerReference: refreshed.providerReference, providerStatus: status.status, localStatus: refreshed.status },
        });
        return repo.save(refreshed);
      }
      refreshed.reconciliationStatus = 'MATCHED';
      refreshed.reconciledAt = new Date();
      await auditService.log({ action: 'RECONCILIATION_MATCHED', entityType: 'Transaction', entityId: refreshed.id, metadata: { providerReference: refreshed.providerReference } });
      return repo.save(refreshed);
    }

    if (['failed', 'declined', 'reversed'].includes(providerStatus)) {
      if (transaction.status === 'SUCCESS') {
        transaction.reconciliationStatus = 'MISMATCHED';
        transaction.reconciliationNotes = `Provider reported ${status.status} for terminal SUCCESS transaction`;
        await auditService.log({
          action: 'RECONCILIATION_MISMATCHED',
          entityType: 'Transaction',
          entityId: transaction.id,
          metadata: { providerReference: transaction.providerReference, providerStatus, localStatus: transaction.status },
        });
        return repo.save(transaction);
      }
      if (!['FAILED', 'REVERSED'].includes(transaction.status)) {
        await ledgerService.reverseExternalHold(transaction.id, status.status, {
          id: status.id,
          reference: transaction.providerReference,
          status: status.status,
        });
      }
      const refreshed = await repo.findOneOrFail({ where: { id: transaction.id } });
      refreshed.reconciliationStatus = providerStatus === 'reversed' ? 'MATCHED' : 'FAILED';
      refreshed.reconciledAt = new Date();
      await auditService.log({ action: 'RECONCILIATION_FAILED_OR_REVERSED', entityType: 'Transaction', entityId: refreshed.id, metadata: { providerReference: refreshed.providerReference, providerStatus } });
      return repo.save(refreshed);
    }

    transaction.reconciliationStatus = 'MANUAL_REVIEW';
    transaction.reconciliationNotes = `Unhandled provider status: ${status.status}`;
    await auditService.log({ action: 'RECONCILIATION_MANUAL_REVIEW', entityType: 'Transaction', entityId: transaction.id, metadata: { providerReference: transaction.providerReference, providerStatus: status.status } });
    return repo.save(transaction);
  }

  async reconcileStaleTransactions(thresholdMinutes = Number(process.env.RECONCILIATION_STALE_MINUTES || 30)) {
    if (this.running) {
      logger.warn('reconciliation_skipped_already_running');
      return { processed: 0, matched: 0, failed: 0, manualReview: 0, skipped: true };
    }

    this.running = true;
    const summary = { processed: 0, matched: 0, failed: 0, manualReview: 0, skipped: false };
    try {
      const transactions = await this.findStaleProviderTransactions(thresholdMinutes);
      for (const transaction of transactions) {
        try {
          const reconciled = await this.reconcileTransaction(transaction);
          summary.processed += 1;
          if (reconciled.reconciliationStatus === 'MATCHED') summary.matched += 1;
          if (reconciled.reconciliationStatus === 'FAILED' || reconciled.reconciliationStatus === 'MISMATCHED') summary.failed += 1;
          if (reconciled.reconciliationStatus === 'MANUAL_REVIEW') summary.manualReview += 1;
        } catch (error) {
          summary.failed += 1;
          logger.error('reconciliation_transaction_failed', error, { transactionId: transaction.id });
        }
      }
      logger.info('reconciliation_completed', summary);
      return summary;
    } finally {
      this.running = false;
    }
  }
}

export const reconciliationService = new ReconciliationService();
