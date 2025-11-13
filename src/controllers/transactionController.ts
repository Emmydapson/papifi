/* ---------------------------------------------
FILE: src/controllers/transaction.controller.ts
--------------------------------------------- */

import { Router, Request, Response } from 'express';
import { AppDataSource } from '../database';
import { Transaction } from '../entities/Transaction';
import { Wallet } from '../entities/Wallet';
import { VirtualCard } from '../entities/virtualCard';
import { MapleRadService } from '../services/mapleradService';

const router = Router();
const txRepo = AppDataSource.getRepository(Transaction);
const walletRepo = AppDataSource.getRepository(Wallet);
const cardRepo = AppDataSource.getRepository(VirtualCard);
const mapleRadService = new MapleRadService();

/** ------------------------------
 * Record transaction helper
 * ------------------------------ */
const recordTransaction = async (
  senderWalletId: string,
  recipientWalletId: string,
  amount: number,
  currency: 'USD' | 'GBP' | 'NGN',
  description: string
): Promise<Transaction> => {
  const senderWallet = await walletRepo.findOne({ where: { id: senderWalletId } });
  const recipientWallet = await walletRepo.findOne({ where: { id: recipientWalletId } });

  if (!senderWallet || !recipientWallet)
    throw new Error('Invalid sender or recipient wallet');

  const tx = txRepo.create({
    senderWallet,
    recipientWallet,
    amount,
    currency,
    description,
  });

  await txRepo.save(tx);
  return tx;
};

/** ------------------------------
 * Fetch all transactions (wallet + virtual card)
 * ------------------------------ */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { walletId, cardId, type, startDate, endDate } = req.query as {
      walletId?: string;
      cardId?: string;
      type?: 'sent' | 'received';
      startDate?: string;
      endDate?: string;
    };

    const qb = txRepo.createQueryBuilder('t');

    if (walletId) {
      if (type === 'sent') qb.where('t.senderWalletId = :walletId', { walletId });
      else if (type === 'received') qb.where('t.recipientWalletId = :walletId', { walletId });
      else qb.where('t.senderWalletId = :walletId OR t.recipientWalletId = :walletId', { walletId });
    }

    if (startDate) qb.andWhere('t.createdAt >= :start', { start: startDate });
    if (endDate) qb.andWhere('t.createdAt <= :end', { end: endDate });

    qb.orderBy('t.createdAt', 'DESC');

    const walletTx = await qb.getMany();

    // Fetch virtual card transactions if cardId is provided
    let cardTx: any[] = [];
    if (cardId) {
      try {
        cardTx = await mapleRadService.getCardTransactions(cardId);
      } catch (err) {
        console.warn('Failed to fetch card transactions:', err);
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
    console.error('fetch transactions error:', err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

/** ------------------------------
 * Log a manual transaction (internal)
 * ------------------------------ */
router.post('/log', async (req: Request, res: Response) => {
  try {
    const { senderWalletId, recipientWalletId, amount, currency, description } = req.body;
    if (!senderWalletId || !recipientWalletId || !amount || !currency)
      return res.status(400).json({ ok: false, message: 'Missing parameters' });

    const tx = await recordTransaction(
      senderWalletId,
      recipientWalletId,
      Number(amount),
      currency,
      description || 'Manual transaction'
    );

    return res.status(201).json({ ok: true, transaction: tx });
  } catch (err: any) {
    console.error('log transaction error:', err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

export default router;
