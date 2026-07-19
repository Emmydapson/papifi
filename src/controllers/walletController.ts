import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import { Currency, Wallet } from '../entities/Wallet';
import { VirtualCard } from '../entities/virtualCard';
import { Transaction } from '../entities/Transaction';
import { MapleRadService } from '../services/mapleradService';
import { ledgerService } from '../services/ledgerService';
import { WebhookEvent } from '../entities/WebhookEvent';
import { auditService } from '../services/auditService';
import { limitService } from '../services/limitService';
import { riskService } from '../services/riskService';

const router = Router();
const mapleRadService = new MapleRadService();
const userRepo = AppDataSource.getRepository(User);
const walletRepo = AppDataSource.getRepository(Wallet);
const cardRepo = AppDataSource.getRepository(VirtualCard);
const txRepo = AppDataSource.getRepository(Transaction);
const webhookEventRepo = AppDataSource.getRepository(WebhookEvent);

const cardResponse = (card: VirtualCard) => ({
  id: card.id,
  mapleradCardId: card.mapleradCardId,
  cardLast4: card.cardLast4,
  expirationDate: card.expirationDate,
  brand: card.brand,
  currency: card.currency,
  status: card.status,
  isFrozen: card.isFrozen,
  createdAt: card.createdAt,
});

const getIdempotencyKey = (req: Request) =>
  (req.headers['idempotency-key'] as string | undefined) || req.body?.idempotencyKey;
const requireIdempotencyKey = (req: Request) => {
  const key = getIdempotencyKey(req);
  if (!key || typeof key !== 'string' || key.trim().length < 8) {
    return null;
  }
  return key.trim();
};
const recordWebhookEvent = async (eventData: any) => {
  if (!eventData?.eventId || !eventData?.event) return false;
  const existing = await webhookEventRepo.findOne({ where: { id: eventData.eventId } });
  if (existing) return true;
  try {
    await webhookEventRepo.save(
      webhookEventRepo.create({
        id: eventData.eventId,
        type: eventData.event,
        provider: 'maplerad',
        reference: eventData.reference,
      })
    );
  } catch {
    return true;
  }
  return false;
};

const sanitizeProviderSnapshot = (eventData: any) => ({
  id: eventData?.data?.id,
  reference: eventData?.reference,
  status: eventData?.providerStatus || eventData?.data?.status,
  event: eventData?.event,
});

const requirePin = async (userId: string, pin?: string) => {
  const user = await userRepo.findOne({ where: { id: userId } });
  if (!user?.transactionPin || !pin) return false;
  return bcrypt.compare(pin, user.transactionPin);
};

const findOwnedWallet = (walletId: string, userId: string) =>
  walletRepo.findOne({ where: { id: walletId, user: { id: userId } } });

const findOwnedCard = (cardId: string, userId: string) =>
  cardRepo.findOne({ where: { id: cardId, wallet: { user: { id: userId } } }, relations: ['wallet', 'wallet.user'] });

router.post('/create/:userId', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId || req.params.userId !== userId) return res.status(403).json({ ok: false, message: 'Forbidden' });

    const existing = await walletRepo.findOne({ where: { user: { id: userId }, currency: 'NGN' } });
    if (existing) return res.status(200).json({ ok: true, wallet: existing });

    await mapleRadService.createVirtualAccountForUser(userId, 'NGN');
    const wallet = await walletRepo.findOne({ where: { user: { id: userId }, currency: 'NGN' } });
    await auditService.log({ actorUserId: userId, targetUserId: userId, action: 'WALLET_CREATED', entityType: 'Wallet', entityId: wallet?.id, req });
    return res.status(201).json({ ok: true, wallet });
  } catch (err: any) {
    return res.status(400).json({ ok: false, message: err?.message || 'error' });
  }
});

router.post('/create-usd/:userId', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId || req.params.userId !== userId) return res.status(403).json({ ok: false, message: 'Forbidden' });

    const usdAccountRequest = await mapleRadService.createUsdVirtualAccount(userId);
    return res.status(201).json({ ok: true, usdAccountRequest });
  } catch (err: any) {
    return res.status(400).json({ ok: false, message: err?.message || 'error' });
  }
});

router.get('/balance/:userId', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId || req.params.userId !== userId) return res.status(403).json({ ok: false, message: 'Forbidden' });

    const wallets = await walletRepo.find({ where: { user: { id: userId } } });
    return res.json({ ok: true, wallets });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

router.post('/withdraw', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { amount, currency, bankCode, accountNumber, accountName, description, transactionPin } = req.body;
    if (!userId) return res.status(401).json({ ok: false, message: 'Authentication required' });
    if (!amount || !currency || !bankCode || !accountNumber)
      return res.status(400).json({ ok: false, message: 'missing parameters' });
    if (!(await requirePin(userId, transactionPin))) {
      await riskService.flag({ userId, rule: 'FAILED_PIN_ATTEMPT_WITHDRAWAL', severity: 'MEDIUM', metadata: { endpoint: 'withdraw' } });
      return res.status(403).json({ ok: false, message: 'Invalid transaction PIN' });
    }
    const idempotencyKey = requireIdempotencyKey(req);
    if (!idempotencyKey) {
      return res.status(400).json({ ok: false, message: 'A valid Idempotency-Key header or idempotencyKey body value is required' });
    }

    const wallet = await walletRepo.findOne({ where: { user: { id: userId }, currency } });
    if (!wallet) return res.status(404).json({ ok: false, message: 'wallet not found' });
    await limitService.assertCanDebit(wallet.user, 'withdrawal', Number(amount));

    const hold = await ledgerService.placeExternalDebitHold({
      walletId: wallet.id,
      userId,
      amount: Number(amount),
      currency,
      idempotencyKey,
      type: 'withdrawal',
      holdType: 'WITHDRAWAL_HOLD',
      description: description || 'Wallet withdrawal',
      provider: 'maplerad',
    });
    await auditService.log({ actorUserId: userId, targetUserId: userId, action: 'WITHDRAWAL_REQUESTED', entityType: 'Transaction', entityId: hold.transaction.id, metadata: { amount: Number(amount), currency }, req });
    if (hold.duplicate) {
      await riskService.flag({ userId, transactionId: hold.transaction.id, rule: 'DUPLICATE_IDEMPOTENCY_WITHDRAWAL', severity: 'LOW', metadata: { idempotencyKey } });
      return res.status(200).json({ ok: true, transaction: hold.transaction, duplicate: true });
    }

    try {
      const result = await mapleRadService.createWithdrawal(
        userId,
        Number(amount),
        currency,
        { bankCode, accountNumber, accountName },
        description
      );
      const providerReference = result?.reference ?? result?.id;
      const transaction = await ledgerService.markExternalSubmitted(
        hold.transaction.id,
        providerReference,
        result?.status,
        { id: result?.id, reference: providerReference, status: result?.status }
      );
      await riskService.evaluateMoneyMovement(wallet.user, Number(amount), transaction);
      await auditService.log({ actorUserId: userId, targetUserId: userId, action: 'WITHDRAWAL_SUBMITTED', entityType: 'Transaction', entityId: transaction.id, metadata: { providerReference, status: result?.status }, req });

      return res.json({ ok: true, transaction, provider: { reference: providerReference, status: result?.status } });
    } catch (err: any) {
      const transaction = await ledgerService.reverseExternalHold(hold.transaction.id, 'provider_call_failed', {
        message: err?.message || 'provider_error',
      });
      await auditService.log({ actorUserId: userId, targetUserId: userId, action: 'WITHDRAWAL_REVERSED', entityType: 'Transaction', entityId: transaction.id, metadata: { reason: 'provider_call_failed' }, req });
      return res.status(502).json({ ok: false, message: err?.message || 'provider_error', transaction });
    }
  } catch (err: any) {
    const message = err?.message || 'error';
    const status = /limit|not allowed|Insufficient|KYC|idempotency/i.test(message) ? 400 : 500;
    if (req.user?.id) await auditService.log({ actorUserId: req.user.id, targetUserId: req.user.id, action: 'WITHDRAWAL_FAILED', entityType: 'Transaction', metadata: { reason: message }, req });
    return res.status(status).json({ ok: false, message });
  }
});

router.post('/cards/create', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { walletId, currency } = req.body;
    if (!userId) return res.status(401).json({ ok: false, message: 'Authentication required' });
    if (!walletId || !currency) return res.status(400).json({ ok: false, message: 'walletId and currency required' });

    const wallet = await findOwnedWallet(walletId, userId);
    if (!wallet) return res.status(404).json({ ok: false, message: 'wallet not found' });

    const cardData = await mapleRadService.createVirtualCard(walletId, currency);
    const pan = cardData.card_number ?? cardData.cardNumber;
    const newCard = cardRepo.create({
      wallet,
      mapleradCardId: cardData.id,
      cardLast4: pan ? String(pan).slice(-4) : undefined,
      expirationDate: cardData.expiry ?? cardData.expiration,
      brand: cardData.brand,
      currency,
    });
    await cardRepo.save(newCard);
    await auditService.log({ actorUserId: userId, targetUserId: userId, action: 'CARD_CREATED', entityType: 'VirtualCard', entityId: newCard.id, metadata: { currency }, req });

    return res.json({ ok: true, card: cardResponse(newCard) });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

router.post('/cards/:id/fund', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { amount, currency, transactionPin } = req.body;
    if (!userId) return res.status(401).json({ ok: false, message: 'Authentication required' });
    if (!amount || !currency) return res.status(400).json({ ok: false, message: 'amount and currency required' });
    if (!(await requirePin(userId, transactionPin))) {
      await riskService.flag({ userId, rule: 'FAILED_PIN_ATTEMPT_CARD_FUNDING', severity: 'MEDIUM', metadata: { cardId: req.params.id } });
      return res.status(403).json({ ok: false, message: 'Invalid transaction PIN' });
    }
    const idempotencyKey = requireIdempotencyKey(req);
    if (!idempotencyKey) {
      return res.status(400).json({ ok: false, message: 'A valid Idempotency-Key header or idempotencyKey body value is required' });
    }

    const card = await findOwnedCard(req.params.id, userId);
    if (!card?.wallet) return res.status(404).json({ ok: false, message: 'Card not found' });
    await limitService.assertCanDebit(card.wallet.user, 'card_funding', Number(amount));
    const hold = await ledgerService.placeExternalDebitHold({
      walletId: card.wallet.id,
      userId,
      amount: Number(amount),
      currency,
      idempotencyKey,
      type: 'transfer',
      holdType: 'CARD_FUNDING_HOLD',
      description: 'Virtual card funding',
      provider: 'maplerad',
    });
    await auditService.log({ actorUserId: userId, targetUserId: userId, action: 'CARD_FUNDING_REQUESTED', entityType: 'Transaction', entityId: hold.transaction.id, metadata: { amount: Number(amount), currency, cardId: card.id }, req });
    if (hold.duplicate) {
      await riskService.flag({ userId, transactionId: hold.transaction.id, rule: 'DUPLICATE_IDEMPOTENCY_CARD_FUNDING', severity: 'LOW', metadata: { idempotencyKey } });
      return res.status(200).json({ ok: true, transaction: hold.transaction, duplicate: true });
    }

    try {
      const result = await mapleRadService.fundCard(card.id, Number(amount), currency);
      const providerReference = result?.reference ?? result?.id;
      const transaction = await ledgerService.markExternalSubmitted(
        hold.transaction.id,
        providerReference,
        result?.status,
        { id: result?.id, reference: providerReference, status: result?.status }
      );
      await riskService.evaluateMoneyMovement(card.wallet.user, Number(amount), transaction);
      await auditService.log({ actorUserId: userId, targetUserId: userId, action: 'CARD_FUNDING_SUBMITTED', entityType: 'Transaction', entityId: transaction.id, metadata: { providerReference, status: result?.status }, req });
      return res.json({ ok: true, transaction, provider: { reference: providerReference, status: result?.status } });
    } catch (err: any) {
      const transaction = await ledgerService.reverseExternalHold(hold.transaction.id, 'provider_call_failed', {
        message: err?.message || 'provider_error',
      });
      await auditService.log({ actorUserId: userId, targetUserId: userId, action: 'CARD_FUNDING_REVERSED', entityType: 'Transaction', entityId: transaction.id, metadata: { reason: 'provider_call_failed' }, req });
      return res.status(502).json({ ok: false, message: err?.message || 'provider_error', transaction });
    }
  } catch (err: any) {
    const message = err?.message || 'error';
    const status = /limit|not allowed|Insufficient|KYC|idempotency/i.test(message) ? 400 : 500;
    if (req.user?.id) await auditService.log({ actorUserId: req.user.id, targetUserId: req.user.id, action: 'CARD_FUNDING_FAILED', entityType: 'Transaction', metadata: { reason: message }, req });
    return res.status(status).json({ ok: false, message });
  }
});

router.post('/cards/:id/withdraw', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { amount, currency, transactionPin } = req.body;
    if (!userId) return res.status(401).json({ ok: false, message: 'Authentication required' });
    if (!amount || !currency) return res.status(400).json({ ok: false, message: 'amount and currency required' });
    if (!(await requirePin(userId, transactionPin))) {
      await riskService.flag({ userId, rule: 'FAILED_PIN_ATTEMPT_CARD_WITHDRAWAL', severity: 'MEDIUM', metadata: { cardId: req.params.id } });
      return res.status(403).json({ ok: false, message: 'Invalid transaction PIN' });
    }
    const idempotencyKey = requireIdempotencyKey(req);
    if (!idempotencyKey) {
      return res.status(400).json({ ok: false, message: 'A valid Idempotency-Key header or idempotencyKey body value is required' });
    }

    const card = await findOwnedCard(req.params.id, userId);
    if (!card) return res.status(404).json({ ok: false, message: 'Card not found' });

    const result = await mapleRadService.withdrawFromCard(card.id, Number(amount), currency);
    const providerReference = result?.reference ?? result?.id ?? `card-withdraw:${idempotencyKey}`;
    const credit = await ledgerService.creditDeposit({
      walletId: card.wallet.id,
      userId,
      amount: Number(amount),
      currency,
      provider: 'maplerad',
      providerReference,
      providerStatus: result?.status,
      providerPayload: { id: result?.id, reference: providerReference, status: result?.status },
      description: 'Virtual card withdrawal',
    });
    await auditService.log({ actorUserId: userId, targetUserId: userId, action: 'CARD_WITHDRAWAL_CREDITED', entityType: 'Transaction', entityId: credit.transaction.id, metadata: { amount: Number(amount), currency, providerReference }, req });
    return res.json({ ok: true, transaction: credit.transaction, provider: { reference: providerReference, status: result?.status } });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

router.post('/cards/:id/freeze', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, message: 'Authentication required' });

    const card = await findOwnedCard(req.params.id, userId);
    if (!card) return res.status(404).json({ ok: false, message: 'Card not found' });

    await mapleRadService.freezeCard(card.mapleradCardId || card.id);
    card.isFrozen = true;
    await cardRepo.save(card);
    await auditService.log({ actorUserId: userId, targetUserId: userId, action: 'CARD_FROZEN', entityType: 'VirtualCard', entityId: card.id, req });

    return res.json({ ok: true, message: 'Card frozen successfully', card: cardResponse(card) });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

router.post('/cards/:id/unfreeze', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, message: 'Authentication required' });

    const card = await findOwnedCard(req.params.id, userId);
    if (!card) return res.status(404).json({ ok: false, message: 'Card not found' });

    await mapleRadService.unfreezeCard(card.mapleradCardId || card.id);
    card.isFrozen = false;
    await cardRepo.save(card);
    await auditService.log({ actorUserId: userId, targetUserId: userId, action: 'CARD_UNFROZEN', entityType: 'VirtualCard', entityId: card.id, req });

    return res.json({ ok: true, message: 'Card unfrozen successfully', card: cardResponse(card) });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || 'error' });
  }
});

export const mapleradWebhookHandler = async (req: Request, res: Response) => {
  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : (req as any).rawBody?.toString('utf8') || JSON.stringify(req.body);

    const svixId = req.headers['svix-id'] as string | undefined;
    const svixTimestamp = req.headers['svix-timestamp'] as string | undefined;
    const svixSignature = req.headers['svix-signature'] as string | undefined;

    if (!svixId || !svixTimestamp || !svixSignature) {
      return res.status(400).json({ ok: false, message: 'Missing Maplerad webhook signature headers' });
    }
    if (!mapleRadService.verifyWebhookSignature({ svixId, svixTimestamp, svixSignature }, rawBody)) {
      return res.status(401).json({ ok: false, message: 'Invalid webhook signature' });
    }

    const eventData = await mapleRadService.handleWebhook(rawBody);

    if (eventData?.type === 'DEPOSIT_RECORDED') {
      const duplicateEvent = await webhookEventRepo.findOne({ where: { id: eventData.eventId } });
      if (duplicateEvent) return res.status(200).json({ ok: true, duplicate: true });
      if (!eventData.amount || !eventData.currency || !eventData.customerId) {
        return res.status(200).json({ ok: true, ignored: true });
      }
      const user = await userRepo.findOne({ where: { mapleradCustomerId: eventData.customerId } });
      if (user) {
        const wallet = await walletRepo.findOne({ where: { user: { id: user.id }, currency: eventData.currency } });
        if (wallet) {
          const credit = await ledgerService.creditDeposit({
            walletId: wallet.id,
            userId: user.id,
            amount: eventData.amount,
            currency: eventData.currency,
            provider: 'maplerad',
            providerReference: eventData.reference,
            providerStatus: eventData.providerStatus,
            providerPayload: eventData.providerPayload,
            description: 'Deposit via Maplerad virtual account',
          });
          await recordWebhookEvent(eventData);
          await auditService.log({ action: 'DEPOSIT_WEBHOOK_PROCESSED', entityType: 'WebhookEvent', entityId: eventData.eventId, metadata: { providerReference: eventData.reference, duplicate: credit.duplicate === true }, req });
          return res.status(200).json({ ok: true, duplicate: credit.duplicate === true });
        }
      }
    }

    if (eventData?.type === 'TRANSFER_EVENT' && eventData.reference) {
      const duplicate = await recordWebhookEvent(eventData);
      if (duplicate) return res.status(200).json({ ok: true, duplicate: true });

      const transaction = await AppDataSource.getRepository(Transaction).findOne({
        where: { provider: 'maplerad', providerReference: eventData.reference },
      });
      if (transaction) {
        const terminal = ['SUCCESS', 'FAILED', 'REVERSED'].includes(transaction.status);
        if (eventData.event === 'transfer.successful') {
          if (terminal && transaction.status !== 'SUCCESS') {
            transaction.reconciliationStatus = 'MISMATCHED';
            transaction.reconciliationNotes = `Contradictory terminal webhook: ${eventData.event}`;
            await txRepo.save(transaction);
            await auditService.log({ action: 'TRANSFER_WEBHOOK_MANUAL_REVIEW', entityType: 'Transaction', entityId: transaction.id, metadata: sanitizeProviderSnapshot(eventData), req });
          } else {
            await ledgerService.markExternalSuccess(transaction.id, eventData.reference, eventData.providerStatus, sanitizeProviderSnapshot(eventData));
            await auditService.log({ action: 'TRANSFER_WEBHOOK_SETTLED', entityType: 'Transaction', entityId: transaction.id, metadata: sanitizeProviderSnapshot(eventData), req });
          }
        } else if (eventData.event === 'transfer.failed') {
          if (terminal && transaction.status === 'SUCCESS') {
            transaction.reconciliationStatus = 'MISMATCHED';
            transaction.reconciliationNotes = `Contradictory terminal webhook: ${eventData.event}`;
            await txRepo.save(transaction);
            await auditService.log({ action: 'TRANSFER_WEBHOOK_MANUAL_REVIEW', entityType: 'Transaction', entityId: transaction.id, metadata: sanitizeProviderSnapshot(eventData), req });
          } else {
            await ledgerService.reverseExternalHold(transaction.id, eventData.providerStatus, sanitizeProviderSnapshot(eventData));
            await auditService.log({ action: 'TRANSFER_WEBHOOK_REVERSED', entityType: 'Transaction', entityId: transaction.id, metadata: sanitizeProviderSnapshot(eventData), req });
          }
        }
      }

      return res.status(200).json({ ok: true, duplicate: false });
    }

    const duplicate = await recordWebhookEvent(eventData);
    await auditService.log({ action: duplicate ? 'DEPOSIT_WEBHOOK_IGNORED' : 'WEBHOOK_RECEIVED', entityType: 'WebhookEvent', entityId: eventData?.eventId, metadata: { type: eventData?.type, duplicate }, req });

    if (eventData?.type === 'USD_ACCOUNT_APPROVED' && eventData.customerId && eventData.accountId) {
      const user = await userRepo.findOne({ where: { mapleradCustomerId: eventData.customerId } });
      if (user) {
        const wallet = await walletRepo.findOne({ where: { user: { id: user.id } } });
        if (wallet) {
          wallet.usdAccountId = eventData.accountId;
          wallet.usdAccountStatus = 'approved';
          await walletRepo.save(wallet);
        }
      }
    }

    return res.status(200).json({ ok: true, duplicate });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || 'Internal error' });
  }
};

export default router;
