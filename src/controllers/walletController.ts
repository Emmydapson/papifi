/* ---------------------------------------------
FILE: src/controllers/wallet.controller.ts
--------------------------------------------- */
import express from 'express';
import { Router, Request, Response } from 'express';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import { Wallet } from '../entities/Wallet';
import { VirtualCard } from '../entities/virtualCard';
import { MapleRadService } from '../services/mapleradService';


const router = Router();
const mapleRadService = new MapleRadService();
const userRepo = AppDataSource.getRepository(User);
const walletRepo = AppDataSource.getRepository(Wallet);
const cardRepo = AppDataSource.getRepository(VirtualCard);

/** ------------------------------
 * WALLET ENDPOINTS
 * ------------------------------ */

// create virtual account / deposit account for user
router.post('/create/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const result = await mapleRadService.createVirtualAccountForUser(userId, 'NGN');
    return res.status(201).json({ ok: true, result });
  } catch (err: any) {
    console.error('create virtual account error:', err?.message || err);
    return res.status(400).json({ ok: false, message: err?.message || 'error' });
  }
});

// get wallet balances for user
router.get('/balance/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const user = await userRepo.findOne({ where: { id: userId }, relations: ['wallets'] });
    if (!user) return res.status(404).json({ ok: false, message: 'user not found' });
    return res.json({ ok: true, wallets: user.wallets });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

// initiate withdrawal from wallet to bank
router.post('/withdraw', async (req: Request, res: Response) => {
  try {
    const { userId, amount, currency, bankCode, accountNumber, accountName, description } = req.body;
    if (!userId || !amount || !currency || !bankCode || !accountNumber)
      return res.status(400).json({ ok: false, message: 'missing parameters' });

    const result = await mapleRadService.createWithdrawal(
      userId,
      Number(amount),
      currency,
      { bankCode, accountNumber, accountName },
      description
    );

    return res.json({ ok: true, result });
  } catch (err: any) {
    console.error('withdraw error:', err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

/** ------------------------------
 * VIRTUAL CARD ENDPOINTS
 * ------------------------------ */

// create virtual card
router.post('/cards/create', async (req: Request, res: Response) => {
  try {
    const { walletId, currency } = req.body;
    if (!walletId || !currency) return res.status(400).json({ ok: false, message: 'walletId and currency required' });

    const cardData = await mapleRadService.createVirtualCard(walletId, currency);

    const wallet = await walletRepo.findOne({ where: { id: walletId } });
if (!wallet) return res.status(404).json({ ok: false, message: 'wallet not found' });

const newCard = cardRepo.create({
  wallet,
  cardNumber: cardData.cardNumber,
  cvv: cardData.cvv,
  expirationDate: cardData.expirationDate,
});


    await cardRepo.save(newCard);

    return res.json({ ok: true, card: newCard });
  } catch (err: any) {
    console.error('create card error:', err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

// fund virtual card
router.post('/cards/:id/fund', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, currency } = req.body;
    if (!amount || !currency) return res.status(400).json({ ok: false, message: 'amount and currency required' });

    const result = await mapleRadService.fundCard(id, Number(amount), currency);
    return res.json({ ok: true, result });
  } catch (err: any) {
    console.error('fund card error:', err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

// withdraw from virtual card
router.post('/cards/:id/withdraw', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, currency } = req.body;
    if (!amount || !currency) return res.status(400).json({ ok: false, message: 'amount and currency required' });

    const result = await mapleRadService.withdrawFromCard(id, Number(amount), currency);
    return res.json({ ok: true, result });
  } catch (err: any) {
    console.error('withdraw from card error:', err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

// freeze virtual card
router.post('/cards/:id/freeze', async (req: Request, res: Response) => {
  try {
    const card = await cardRepo.findOne({ where: { id: req.params.id } });
    if (!card) return res.status(404).json({ ok: false, message: 'Card not found' });

    await mapleRadService.freezeCard(card.cardNumber);
    card.isFrozen = true;
    await cardRepo.save(card);

    return res.json({ ok: true, message: 'Card frozen successfully', card });
  } catch (err: any) {
    console.error('freeze card error:', err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

// unfreeze virtual card
router.post('/cards/:id/unfreeze', async (req: Request, res: Response) => {
  try {
    const card = await cardRepo.findOne({ where: { id: req.params.id } });
    if (!card) return res.status(404).json({ ok: false, message: 'Card not found' });

    await mapleRadService.unfreezeCard(card.cardNumber);
    card.isFrozen = false;
    await cardRepo.save(card);

    return res.json({ ok: true, message: 'Card unfrozen successfully', card });
  } catch (err: any) {
    console.error('unfreeze card error:', err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

// Add this in wallet.controller.ts
router.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const signature = req.headers[process.env.MAPLERAD_SIGNATURE_HEADER || 'x-maplerad-signature'] as string;
    const rawBody = req.body.toString();

    if (!signature) {
      return res.status(400).json({ ok: false, message: 'Missing signature header' });
    }

    const isValid = mapleRadService.verifyWebhookSignature(signature, rawBody);
    if (!isValid) {
      return res.status(401).json({ ok: false, message: 'Invalid webhook signature' });
    }

    const eventData = await mapleRadService.handleWebhook(rawBody);
    // Optional: log or handle specific events here
    console.log('Webhook event processed:', eventData);

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('Webhook processing error:', err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || 'Internal error' });
  }
});


export default router;
