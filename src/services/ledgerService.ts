import { EntityManager } from 'typeorm';
import { AppDataSource } from '../database';
import { Currency, Wallet } from '../entities/Wallet';
import { LedgerAccount, LedgerAccountType } from '../entities/LedgerAccount';
import { LedgerEntry } from '../entities/LedgerEntry';
import { LedgerJournal, LedgerJournalType } from '../entities/LedgerJournal';
import { Transaction, TransactionStatus, TransactionType } from '../entities/Transaction';

type JournalEntryInput = {
  account: LedgerAccount;
  debit?: number;
  credit?: number;
};

type CreateJournalInput = {
  type: LedgerJournalType;
  currency: Currency;
  entries: JournalEntryInput[];
  idempotencyKey?: string;
  provider?: string;
  providerReference?: string;
  transactionId?: string;
  metadata?: any;
};

type MoneyMovementInput = {
  walletId: string;
  userId: string;
  amount: number;
  currency: Currency;
  idempotencyKey?: string;
  description?: string;
  provider?: string;
  providerReference?: string;
  providerStatus?: string;
  providerPayload?: any;
};

const roundMoney = (value: number) => Math.round(Number(value) * 100) / 100;

export const calculateHoldBalances = (availableBalance: number, pendingBalance: number, amount: number) => {
  const available = roundMoney(availableBalance);
  const pending = roundMoney(pendingBalance);
  const debitAmount = roundMoney(amount);
  if (available < debitAmount) throw new Error('Insufficient balance');
  return {
    availableBalance: roundMoney(available - debitAmount),
    pendingBalance: roundMoney(pending + debitAmount),
    ledgerBalance: roundMoney(available - debitAmount + pending + debitAmount),
  };
};

export const calculatePendingReleaseBalances = (availableBalance: number, pendingBalance: number, amount: number) => {
  const available = roundMoney(availableBalance);
  const pending = roundMoney(pendingBalance);
  const releaseAmount = roundMoney(amount);
  if (pending < releaseAmount) throw new Error('Pending balance is insufficient for release');
  return {
    availableBalance: available,
    pendingBalance: roundMoney(pending - releaseAmount),
    ledgerBalance: roundMoney(available + pending - releaseAmount),
  };
};

export const calculatePendingReversalBalances = (availableBalance: number, pendingBalance: number, amount: number) => {
  const available = roundMoney(availableBalance);
  const pending = roundMoney(pendingBalance);
  const reversalAmount = roundMoney(amount);
  if (pending < reversalAmount) throw new Error('Pending balance is insufficient for reversal');
  return {
    availableBalance: roundMoney(available + reversalAmount),
    pendingBalance: roundMoney(pending - reversalAmount),
    ledgerBalance: roundMoney(available + reversalAmount + pending - reversalAmount),
  };
};

export const validateBalancedEntries = (entries: Array<{ debit?: number; credit?: number }>) => {
  if (entries.length < 2) throw new Error('A ledger journal requires at least two entries');

  for (const entry of entries) {
    const entryDebit = Number(entry.debit || 0);
    const entryCredit = Number(entry.credit || 0);
    if (entryDebit < 0 || entryCredit < 0) throw new Error('Ledger entries cannot be negative');
    if (entryDebit > 0 && entryCredit > 0) throw new Error('A ledger entry cannot have both debit and credit');
  }

  const debit = roundMoney(entries.reduce((sum, entry) => sum + Number(entry.debit || 0), 0));
  const credit = roundMoney(entries.reduce((sum, entry) => sum + Number(entry.credit || 0), 0));

  if (debit <= 0 || credit <= 0) throw new Error('A ledger journal must have positive debit and credit totals');
  if (debit !== credit) throw new Error(`Unbalanced ledger journal: debit ${debit} credit ${credit}`);
};

export class LedgerService {
  private walletAccountKey(walletId: string, currency: Currency) {
    return `wallet:${walletId}:${currency}`;
  }

  private systemAccountKey(type: LedgerAccountType, currency: Currency) {
    return `system:${type}:${currency}`;
  }

  async getOrCreateWalletAccount(manager: EntityManager, wallet: Wallet, currency: Currency) {
    const repo = manager.getRepository(LedgerAccount);
    const accountKey = this.walletAccountKey(wallet.id, currency);
    const existing = await repo.findOne({ where: { accountKey } });
    if (existing) return existing;

    return repo.save(
      repo.create({
        accountKey,
        type: 'USER_WALLET',
        currency,
        name: `Wallet ${wallet.id} ${currency}`,
        wallet,
        walletId: wallet.id,
        user: wallet.user,
        userId: wallet.user?.id,
      })
    );
  }

  async getOrCreateSystemAccount(manager: EntityManager, type: LedgerAccountType, currency: Currency) {
    const repo = manager.getRepository(LedgerAccount);
    const accountKey = this.systemAccountKey(type, currency);
    const existing = await repo.findOne({ where: { accountKey } });
    if (existing) return existing;

    return repo.save(
      repo.create({
        accountKey,
        type,
        currency,
        name: `${type} ${currency}`,
      })
    );
  }

  async createBalancedJournal(manager: EntityManager, input: CreateJournalInput) {
    validateBalancedEntries(input.entries);

    const journalRepo = manager.getRepository(LedgerJournal);
    if (input.idempotencyKey) {
      const existing = await journalRepo.findOne({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { journal: existing, duplicate: true };
    }
    if (input.provider && input.providerReference) {
      const existing = await journalRepo.findOne({
        where: { provider: input.provider, providerReference: input.providerReference },
      });
      if (existing) return { journal: existing, duplicate: true };
    }

    const journal = await journalRepo.save(
      journalRepo.create({
        type: input.type,
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
        provider: input.provider,
        providerReference: input.providerReference,
        transactionId: input.transactionId,
        metadata: input.metadata,
      })
    );

    const entryRepo = manager.getRepository(LedgerEntry);
    await entryRepo.save(
      input.entries.map((entry) =>
        entryRepo.create({
          journal,
          journalId: journal.id,
          account: entry.account,
          accountId: entry.account.id,
          debit: roundMoney(entry.debit || 0),
          credit: roundMoney(entry.credit || 0),
        })
      )
    );

    return { journal, duplicate: false };
  }

  private async lockWallet(manager: EntityManager, walletId: string, userId?: string) {
    const wallet = await manager.getRepository(Wallet).findOne({
      where: userId ? { id: walletId, user: { id: userId } } : { id: walletId },
      relations: ['user'],
      lock: { mode: 'pessimistic_write' },
    });
    if (!wallet) throw new Error('Wallet not found');
    return wallet;
  }

  private getWalletCurrencyBalance(wallet: Wallet, currency: Currency) {
    const available = wallet.availableBalance ?? (wallet as any)[currency] ?? wallet.balance ?? 0;
    return roundMoney(Number(available));
  }

  private setLegacyCurrencyBalance(wallet: Wallet, currency: Currency, amount: number) {
    const value = roundMoney(amount);
    (wallet as any)[currency] = value;
    wallet.balance = value;
  }

  async createOpeningBalance(manager: EntityManager, wallet: Wallet, currency: Currency) {
    const amount = roundMoney(Number((wallet as any)[currency] ?? wallet.balance ?? 0));
    wallet.availableBalance = amount;
    wallet.pendingBalance = roundMoney(Number(wallet.pendingBalance || 0));
    wallet.ledgerBalance = roundMoney(amount + Number(wallet.pendingBalance || 0));
    await manager.getRepository(Wallet).save(wallet);

    if (amount <= 0) {
      await this.getOrCreateWalletAccount(manager, wallet, currency);
      return;
    }

    const idempotencyKey = `opening:${wallet.id}:${currency}`;
    const walletAccount = await this.getOrCreateWalletAccount(manager, wallet, currency);
    const openingAccount = await this.getOrCreateSystemAccount(manager, 'PROVIDER_SETTLEMENT', currency);

    await this.createBalancedJournal(manager, {
      type: 'OPENING_BALANCE',
      currency,
      idempotencyKey,
      entries: [
        { account: openingAccount, debit: amount },
        { account: walletAccount, credit: amount },
      ],
      metadata: { walletId: wallet.id },
    });
  }

  async creditDeposit(input: MoneyMovementInput) {
    return AppDataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(Transaction);
      const existing = input.providerReference
        ? await txRepo.findOne({ where: { provider: input.provider || 'maplerad', providerReference: input.providerReference } })
        : undefined;
      if (existing?.status === 'SUCCESS') return { transaction: existing, duplicate: true };

      const wallet = await this.lockWallet(manager, input.walletId, input.userId);
      const walletAccount = await this.getOrCreateWalletAccount(manager, wallet, input.currency);
      const suspenseAccount = await this.getOrCreateSystemAccount(manager, 'PROVIDER_SUSPENSE', input.currency);

      const transaction =
        existing ||
        txRepo.create({
          user: wallet.user,
          amount: input.amount,
          currency: input.currency,
          type: 'deposit',
          status: 'PENDING',
          reference: input.providerReference,
          provider: input.provider || 'maplerad',
          providerReference: input.providerReference,
          providerStatus: input.providerStatus,
          providerPayload: input.providerPayload,
          description: input.description || 'Deposit',
        });

      transaction.status = 'SUCCESS';
      transaction.settledAt = new Date();
      transaction.providerStatus = input.providerStatus || transaction.providerStatus;
      transaction.providerPayload = input.providerPayload || transaction.providerPayload;
      const savedTx = await txRepo.save(transaction);

      const journal = await this.createBalancedJournal(manager, {
        type: 'DEPOSIT',
        currency: input.currency,
        provider: input.provider || 'maplerad',
        providerReference: input.providerReference,
        transactionId: savedTx.id,
        entries: [
          { account: suspenseAccount, debit: input.amount },
          { account: walletAccount, credit: input.amount },
        ],
        metadata: { transactionId: savedTx.id },
      });
      if (journal.duplicate) return { transaction: savedTx, duplicate: true };

      wallet.availableBalance = roundMoney(this.getWalletCurrencyBalance(wallet, input.currency) + input.amount);
      wallet.ledgerBalance = roundMoney(Number(wallet.availableBalance) + Number(wallet.pendingBalance || 0));
      this.setLegacyCurrencyBalance(wallet, input.currency, wallet.availableBalance);
      await manager.getRepository(Wallet).save(wallet);

      return { transaction: savedTx, duplicate: false };
    });
  }

  async placeExternalDebitHold(
    input: MoneyMovementInput & { type: Extract<TransactionType, 'withdrawal'> | 'transfer'; holdType: LedgerJournalType }
  ) {
    return AppDataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(Transaction);
      if (input.idempotencyKey) {
        const existing = await txRepo.findOne({ where: { idempotencyKey: input.idempotencyKey } });
        if (existing) return { transaction: existing, duplicate: true };
      }

      const wallet = await this.lockWallet(manager, input.walletId, input.userId);
      if (!wallet.user?.isKYCVerified) throw new Error('KYC verification is required');

      const available = this.getWalletCurrencyBalance(wallet, input.currency);
      if (available < input.amount) throw new Error('Insufficient balance');

      const transaction = await txRepo.save(
        txRepo.create({
          user: wallet.user,
          senderWallet: wallet,
          amount: input.amount,
          currency: input.currency,
          type: input.type,
          status: 'PROCESSING',
          idempotencyKey: input.idempotencyKey,
          provider: input.provider || 'maplerad',
          description: input.description,
        })
      );

      const walletAccount = await this.getOrCreateWalletAccount(manager, wallet, input.currency);
      const suspenseAccount = await this.getOrCreateSystemAccount(manager, 'PROVIDER_SUSPENSE', input.currency);
      await this.createBalancedJournal(manager, {
        type: input.holdType,
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
        transactionId: transaction.id,
        entries: [
          { account: walletAccount, debit: input.amount },
          { account: suspenseAccount, credit: input.amount },
        ],
      });

      const balances = calculateHoldBalances(available, Number(wallet.pendingBalance || 0), input.amount);
      wallet.availableBalance = balances.availableBalance;
      wallet.pendingBalance = balances.pendingBalance;
      wallet.ledgerBalance = balances.ledgerBalance;
      this.setLegacyCurrencyBalance(wallet, input.currency, wallet.availableBalance);
      await manager.getRepository(Wallet).save(wallet);

      return { transaction, duplicate: false };
    });
  }

  async markExternalSuccess(transactionId: string, providerReference?: string, providerStatus?: string, providerPayload?: any) {
    return AppDataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(Transaction);
      const transaction = await txRepo.findOne({ where: { id: transactionId }, lock: { mode: 'pessimistic_write' } });
      if (!transaction) throw new Error('Transaction not found');
      if (transaction.status === 'SUCCESS') return transaction;

      const transactionWithWallet = await txRepo.findOne({
        where: { id: transactionId },
        relations: ['senderWallet', 'senderWallet.user'],
      });
      if (!transactionWithWallet?.senderWallet?.user) throw new Error('Transaction wallet not found');

      const wallet = await this.lockWallet(manager, transactionWithWallet.senderWallet.id, transactionWithWallet.senderWallet.user.id);
      const balances = calculatePendingReleaseBalances(
        Number(wallet.availableBalance || 0),
        Number(wallet.pendingBalance || 0),
        Number(transaction.amount)
      );
      wallet.availableBalance = balances.availableBalance;
      wallet.pendingBalance = balances.pendingBalance;
      wallet.ledgerBalance = balances.ledgerBalance;
      await manager.getRepository(Wallet).save(wallet);

      transaction.status = 'SUCCESS';
      transaction.providerReference = providerReference || transaction.providerReference;
      transaction.reference = providerReference || transaction.reference;
      transaction.providerStatus = providerStatus || transaction.providerStatus;
      transaction.providerPayload = providerPayload || transaction.providerPayload;
      transaction.settledAt = new Date();
      return txRepo.save(transaction);
    });
  }

  async markExternalSubmitted(transactionId: string, providerReference?: string, providerStatus?: string, providerPayload?: any) {
    return AppDataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(Transaction);
      const transaction = await txRepo.findOne({ where: { id: transactionId }, lock: { mode: 'pessimistic_write' } });
      if (!transaction) throw new Error('Transaction not found');
      if (transaction.status === 'SUCCESS' || transaction.status === 'FAILED' || transaction.status === 'REVERSED') return transaction;

      transaction.status = 'PROCESSING';
      transaction.providerReference = providerReference || transaction.providerReference;
      transaction.reference = providerReference || transaction.reference;
      transaction.providerStatus = providerStatus || transaction.providerStatus;
      transaction.providerPayload = providerPayload || transaction.providerPayload;
      return txRepo.save(transaction);
    });
  }

  async reverseExternalHold(transactionId: string, providerStatus?: string, providerPayload?: any) {
    return AppDataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(Transaction);
      const transaction = await txRepo.findOne({ where: { id: transactionId }, lock: { mode: 'pessimistic_write' } });
      if (!transaction) throw new Error('Transaction not found');
      if (transaction.status === 'REVERSED' || transaction.status === 'FAILED') return transaction;

      const transactionWithWallet = await txRepo.findOne({
        where: { id: transactionId },
        relations: ['senderWallet', 'senderWallet.user'],
      });
      if (!transactionWithWallet?.senderWallet?.user) throw new Error('Transaction wallet not found');

      const wallet = await this.lockWallet(manager, transactionWithWallet.senderWallet.id, transactionWithWallet.senderWallet.user.id);
      const walletAccount = await this.getOrCreateWalletAccount(manager, wallet, transaction.currency);
      const suspenseAccount = await this.getOrCreateSystemAccount(manager, 'PROVIDER_SUSPENSE', transaction.currency);

      await this.createBalancedJournal(manager, {
        type: 'REVERSAL',
        currency: transaction.currency,
        idempotencyKey: `reversal:${transaction.id}`,
        transactionId: transaction.id,
        entries: [
          { account: suspenseAccount, debit: Number(transaction.amount) },
          { account: walletAccount, credit: Number(transaction.amount) },
        ],
      });

      const available = this.getWalletCurrencyBalance(wallet, transaction.currency);
      const balances = calculatePendingReversalBalances(
        available,
        Number(wallet.pendingBalance || 0),
        Number(transaction.amount)
      );
      wallet.availableBalance = balances.availableBalance;
      wallet.pendingBalance = balances.pendingBalance;
      wallet.ledgerBalance = balances.ledgerBalance;
      this.setLegacyCurrencyBalance(wallet, transaction.currency, wallet.availableBalance);
      await manager.getRepository(Wallet).save(wallet);

      transaction.status = 'REVERSED';
      transaction.providerStatus = providerStatus || transaction.providerStatus;
      transaction.providerPayload = providerPayload || transaction.providerPayload;
      transaction.failedAt = new Date();
      transaction.reversedAt = new Date();
      return txRepo.save(transaction);
    });
  }

  async transfer(input: MoneyMovementInput & { recipientWalletId: string }) {
    return AppDataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(Transaction);
      if (input.idempotencyKey) {
        const existing = await txRepo.findOne({ where: { idempotencyKey: input.idempotencyKey } });
        if (existing) return { transaction: existing, duplicate: true };
      }

      if (input.walletId === input.recipientWalletId) throw new Error('Cannot transfer to the same wallet');

      const orderedWalletIds = [input.walletId, input.recipientWalletId].sort();
      const lockedWallets: Record<string, Wallet> = {};
      for (const walletId of orderedWalletIds) {
        lockedWallets[walletId] = await this.lockWallet(manager, walletId);
      }

      const sender = lockedWallets[input.walletId];
      const recipient = lockedWallets[input.recipientWalletId];
      if (sender.user?.id !== input.userId) throw new Error('Wallet not found');
      if (!sender.user?.isKYCVerified) throw new Error('KYC verification is required');
      if (sender.id === recipient.id) throw new Error('Cannot transfer to the same wallet');
      if (recipient.currency !== input.currency) throw new Error('Recipient wallet currency mismatch');

      const available = this.getWalletCurrencyBalance(sender, input.currency);
      if (available < input.amount) throw new Error('Insufficient balance');

      const transaction = await txRepo.save(
        txRepo.create({
          user: sender.user,
          senderWallet: sender,
          recipientWallet: recipient,
          amount: input.amount,
          currency: input.currency,
          type: 'transfer',
          status: 'SUCCESS',
          idempotencyKey: input.idempotencyKey,
          description: input.description || 'Internal wallet transfer',
          settledAt: new Date(),
        })
      );

      const senderAccount = await this.getOrCreateWalletAccount(manager, sender, input.currency);
      const recipientAccount = await this.getOrCreateWalletAccount(manager, recipient, input.currency);
      await this.createBalancedJournal(manager, {
        type: 'TRANSFER',
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
        transactionId: transaction.id,
        entries: [
          { account: senderAccount, debit: input.amount },
          { account: recipientAccount, credit: input.amount },
        ],
      });

      sender.availableBalance = roundMoney(available - input.amount);
      sender.ledgerBalance = roundMoney(Number(sender.availableBalance) + Number(sender.pendingBalance || 0));
      this.setLegacyCurrencyBalance(sender, input.currency, sender.availableBalance);

      recipient.availableBalance = roundMoney(this.getWalletCurrencyBalance(recipient, input.currency) + input.amount);
      recipient.ledgerBalance = roundMoney(Number(recipient.availableBalance) + Number(recipient.pendingBalance || 0));
      this.setLegacyCurrencyBalance(recipient, input.currency, recipient.availableBalance);

      await manager.getRepository(Wallet).save([sender, recipient]);
      return { transaction, duplicate: false };
    });
  }
}

export const ledgerService = new LedgerService();
