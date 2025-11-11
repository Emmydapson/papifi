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
) => {
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
    const { userId, walletId, cardId, type, startDate, endDate } = req.query;

    let where: any = {};
    if (walletId) where = [{ senderWalletId: walletId }, { recipientWalletId: walletId }];
    if (type === 'sent') where = { senderWalletId: walletId };
    if (type === 'received') where = { recipientWalletId: walletId };

    const qb = txRepo.createQueryBuilder('t');

    if (walletId) qb.where('t.senderWalletId = :walletId OR t.recipientWalletId = :walletId', { walletId });
    if (startDate) qb.andWhere('t.createdAt >= :start', { start: startDate });
    if (endDate) qb.andWhere('t.createdAt <= :end', { end: endDate });
    qb.orderBy('t.createdAt', 'DESC');

    const walletTx = await qb.getMany();

    // optional: fetch card tx from Maplerad API if supported
    let cardTx: any[] = [];
    if (cardId) {
      try {
        cardTx = await mapleRadService.getCardTransactions(cardId as string);
      } catch {
        cardTx = [];
      }
    }

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
 * Log a manual transaction (optional internal use)
 * ------------------------------ */
router.post('/log', async (req: Request, res: Response) => {
  try {
    const { senderWalletId, recipientWalletId, amount, currency, description } = req.body;
    if (!senderWalletId || !recipientWalletId || !amount || !currency)
      return res.status(400).json({ ok: false, message: 'missing parameters' });

    const tx = await recordTransaction(senderWalletId, recipientWalletId, Number(amount), currency, description);
    return res.status(201).json({ ok: true, transaction: tx });
  } catch (err: any) {
    console.error('log transaction error:', err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

export default router;
