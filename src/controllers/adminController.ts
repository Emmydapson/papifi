import { Request, Response } from 'express';
import { AppDataSource } from '../database';
import { AuditLog } from '../entities/AuditLog';
import { RiskFlag } from '../entities/RiskFlag';
import { Transaction } from '../entities/Transaction';
import { Wallet } from '../entities/Wallet';
import { auditService, sanitizeAuditMetadata } from '../services/auditService';
import { reconciliationService } from '../services/reconciliationService';

const pagination = (req: Request) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  return { page, limit, skip: (page - 1) * limit };
};

export const safeTransactionResponse = (transaction: Transaction) => ({
  id: transaction.id,
  userId: (transaction as any).userId,
  senderWalletId: (transaction as any).senderWalletId,
  recipientWalletId: (transaction as any).recipientWalletId,
  type: transaction.type,
  amount: transaction.amount,
  currency: transaction.currency,
  status: transaction.status,
  reference: transaction.reference,
  provider: transaction.provider,
  providerReference: transaction.providerReference,
  providerStatus: transaction.providerStatus,
  reconciliationStatus: transaction.reconciliationStatus,
  reconciliationNotes: transaction.reconciliationNotes,
  lastCheckedAt: transaction.lastCheckedAt,
  reconciledAt: transaction.reconciledAt,
  settledAt: transaction.settledAt,
  failedAt: transaction.failedAt,
  reversedAt: transaction.reversedAt,
  createdAt: transaction.createdAt,
});

export const listAuditLogs = async (req: Request, res: Response) => {
  const { limit, skip, page } = pagination(req);
  const [items, total] = await AppDataSource.getRepository(AuditLog).findAndCount({
    order: { createdAt: 'DESC' },
    take: limit,
    skip,
  });
  return res.json({ ok: true, page, limit, total, items: items.map((item) => ({ ...item, metadata: sanitizeAuditMetadata(item.metadata) })) });
};

export const listRiskFlags = async (req: Request, res: Response) => {
  const { limit, skip, page } = pagination(req);
  const [items, total] = await AppDataSource.getRepository(RiskFlag).findAndCount({
    where: { status: 'OPEN' },
    order: { createdAt: 'DESC' },
    take: limit,
    skip,
  });
  return res.json({ ok: true, page, limit, total, items: items.map((item) => ({ ...item, metadata: sanitizeAuditMetadata(item.metadata) })) });
};

export const listReconciliationQueue = async (req: Request, res: Response) => {
  const items = await reconciliationService.findStaleProviderTransactions(Number(req.query.thresholdMinutes || 30));
  return res.json({ ok: true, count: items.length, transactions: items.map(safeTransactionResponse) });
};

export const markTransactionManualReview = async (req: Request, res: Response) => {
  const txRepo = AppDataSource.getRepository(Transaction);
  const transaction = await txRepo.findOne({ where: { id: req.params.id } });
  if (!transaction) return res.status(404).json({ ok: false, message: 'Transaction not found' });
  transaction.reconciliationStatus = 'MANUAL_REVIEW';
  transaction.reconciliationNotes = req.body?.notes || 'Marked by admin';
  await txRepo.save(transaction);
  await auditService.log({
    actorUserId: req.user?.id,
    action: 'TRANSACTION_MARKED_MANUAL_REVIEW',
    entityType: 'Transaction',
    entityId: transaction.id,
    metadata: { notes: transaction.reconciliationNotes },
    req,
  });
  return res.json({ ok: true, transaction: safeTransactionResponse(transaction) });
};

export const getUserWalletSummary = async (req: Request, res: Response) => {
  const wallets = await AppDataSource.getRepository(Wallet).find({ where: { user: { id: req.params.userId } } });
  return res.json({
    ok: true,
    userId: req.params.userId,
    wallets: wallets.map((wallet) => ({
      id: wallet.id,
      currency: wallet.currency,
      availableBalance: wallet.availableBalance,
      pendingBalance: wallet.pendingBalance,
      ledgerBalance: wallet.ledgerBalance,
      accountNumber: wallet.accountNumber,
      bankName: wallet.bankName,
    })),
  });
};
