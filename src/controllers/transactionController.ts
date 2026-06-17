/* ---------------------------------------------
FILE: src/controllers/transaction.controller.ts
--------------------------------------------- */

import { Router, Request, Response } from 'express';
import { AppDataSource } from '../database';
import { Transaction } from '../entities/Transaction';
import { Wallet } from '../entities/Wallet';
import { VirtualCard } from '../entities/virtualCard';
import { MapleRadService } from '../services/mapleradService';
import { User } from '../entities/User';
import bcrypt from 'bcryptjs';
import { ledgerService } from '../services/ledgerService';
import { auditService } from '../services/auditService';
import { limitService } from '../services/limitService';
import { riskService } from '../services/riskService';
import { logger } from '../services/logger';

const router = Router();
const txRepo = AppDataSource.getRepository(Transaction);
const walletRepo = AppDataSource.getRepository(Wallet);
const cardRepo = AppDataSource.getRepository(VirtualCard);
const userRepo = AppDataSource.getRepository(User);
const mapleRadService = new MapleRadService();

const getOwnedWalletIds = async (userId: string) => {
  const wallets = await walletRepo.find({ where: { user: { id: userId } } });
  return wallets.map((wallet) => wallet.id);
};

const requirePin = async (userId: string, pin?: string) => {
  const user = await userRepo.findOne({ where: { id: userId } });
  if (!user?.transactionPin || !pin) return false;
  return bcrypt.compare(pin, user.transactionPin);
};
const getIdempotencyKey = (req: Request) =>
  (req.headers['idempotency-key'] as string | undefined) || req.body?.idempotencyKey;
const requireIdempotencyKey = (req: Request) => {
  const key = getIdempotencyKey(req);
  if (!key || typeof key !== 'string' || key.trim().length < 8) {
    return null;
  }
  return key.trim();
};

/** ------------------------------
 * Fetch all transactions (wallet + virtual card)
 * ------------------------------ */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, message: 'Authentication required' });

    const { walletId, cardId, type, startDate, endDate } = req.query as {
      walletId?: string;
      cardId?: string;
      type?: 'sent' | 'received';
      startDate?: string;
      endDate?: string;
    };

    const ownedWalletIds = await getOwnedWalletIds(userId);
    if (walletId && !ownedWalletIds.includes(walletId)) {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }

    const qb = txRepo.createQueryBuilder('t');

    if (walletId) {
      if (type === 'sent') qb.where('t.senderWalletId = :walletId', { walletId });
      else if (type === 'received') qb.where('t.recipientWalletId = :walletId', { walletId });
      else qb.where('t.senderWalletId = :walletId OR t.recipientWalletId = :walletId', { walletId });
    } else if (ownedWalletIds.length > 0) {
      qb.where('t.senderWalletId IN (:...walletIds) OR t.recipientWalletId IN (:...walletIds) OR t.userId = :userId', {
        walletIds: ownedWalletIds,
        userId,
      });
    } else {
      qb.where('t.userId = :userId', { userId });
    }

    if (startDate) qb.andWhere('t.createdAt >= :start', { start: startDate });
    if (endDate) qb.andWhere('t.createdAt <= :end', { end: endDate });

    qb.orderBy('t.createdAt', 'DESC');

    const walletTx = await qb.getMany();

    // Fetch virtual card transactions if cardId is provided
    let cardTx: any[] = [];
    if (cardId) {
      const card = await cardRepo.findOne({ where: { id: cardId, wallet: { user: { id: userId } } } });
      if (!card) return res.status(403).json({ ok: false, message: 'Forbidden' });
      try {
        cardTx = await mapleRadService.getCardTransactions(card.mapleradCardId || card.id);
      } catch (err) {
        logger.warn('card_transactions_fetch_failed', { requestId: (req as any).id, cardId });
        cardTx = [];
      }
    }

    // Merge wallet + card transactions and sort
    const merged = [...walletTx, ...cardTx].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return res.json({
      ok: true,
      count: merged.length,
      transactions: merged,
    });
  } catch (err: any) {
    logger.error('transactions_fetch_failed', err, { requestId: (req as any).id, userId: req.user?.id });
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

/** ------------------------------
 * Log a manual transaction (internal)
 * ------------------------------ */
router.post('/log', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, message: 'Authentication required' });

    const { senderWalletId, recipientWalletId, amount, currency, description, transactionPin } = req.body;
    if (!senderWalletId || !recipientWalletId || !amount || !currency)
      return res.status(400).json({ ok: false, message: 'Missing parameters' });
    if (!(await requirePin(userId, transactionPin))) {
      await riskService.flag({ userId, rule: 'FAILED_PIN_ATTEMPT_TRANSFER', severity: 'MEDIUM', metadata: { senderWalletId, recipientWalletId } });
      return res.status(403).json({ ok: false, message: 'Invalid transaction PIN' });
    }
    const idempotencyKey = requireIdempotencyKey(req);
    if (!idempotencyKey) {
      return res.status(400).json({ ok: false, message: 'A valid Idempotency-Key header or idempotencyKey body value is required' });
    }

    const ownedWalletIds = await getOwnedWalletIds(userId);
    if (!ownedWalletIds.includes(senderWalletId)) {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }
    const senderWallet = await walletRepo.findOne({ where: { id: senderWalletId, user: { id: userId } } });
    if (!senderWallet) return res.status(404).json({ ok: false, message: 'Sender wallet not found' });
    await limitService.assertCanDebit(senderWallet.user, 'transfer', Number(amount));

    const result = await ledgerService.transfer({
      walletId: senderWalletId,
      recipientWalletId,
      userId,
      amount: Number(amount),
      currency,
      idempotencyKey,
      description: description || 'Internal wallet transfer',
    });
    if (result.duplicate) {
      await riskService.flag({ userId, transactionId: result.transaction.id, rule: 'DUPLICATE_IDEMPOTENCY_TRANSFER', severity: 'LOW', metadata: { idempotencyKey } });
    }
    await riskService.evaluateMoneyMovement(senderWallet.user, Number(amount), result.transaction);
    await auditService.log({
      actorUserId: userId,
      targetUserId: userId,
      action: result.duplicate ? 'TRANSFER_DUPLICATE' : 'TRANSFER_SUCCEEDED',
      entityType: 'Transaction',
      entityId: result.transaction.id,
      metadata: { amount: Number(amount), currency, recipientWalletId, duplicate: result.duplicate },
      req,
    });

    return res.status(result.duplicate ? 200 : 201).json({
      ok: true,
      transaction: result.transaction,
      duplicate: result.duplicate,
    });
  } catch (err: any) {
    logger.error('transfer_failed', err, { requestId: (req as any).id, userId: req.user?.id });
    const message = err?.message || 'error';
    const status = /limit|not allowed|Insufficient|KYC|idempotency/i.test(message) ? 400 : 500;
    if (req.user?.id) {
      await auditService.log({ actorUserId: req.user.id, targetUserId: req.user.id, action: 'TRANSFER_FAILED', entityType: 'Transaction', metadata: { reason: message }, req });
    }
    return res.status(status).json({ ok: false, message });
  }
});

export default router;
