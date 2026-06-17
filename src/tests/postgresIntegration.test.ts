import test from 'node:test';
import assert from 'node:assert/strict';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import { Wallet } from '../entities/Wallet';
import { ledgerService } from '../services/ledgerService';
import { reconciliationService } from '../services/reconciliationService';
import { LedgerJournal } from '../entities/LedgerJournal';
import { Transaction } from '../entities/Transaction';
import { LedgerEntry } from '../entities/LedgerEntry';
import { AuditLog } from '../entities/AuditLog';

const testDatabaseUrl = process.env.POSTGRES_TEST_DATABASE_URL;

const withPostgres = testDatabaseUrl ? test : test.skip;

const initDb = async () => {
  if (AppDataSource.isInitialized) return;
  AppDataSource.setOptions({
    url: testDatabaseUrl,
    host: undefined,
    port: undefined,
    username: undefined,
    password: undefined,
    database: undefined,
    dropSchema: true,
    synchronize: false,
    logging: false,
  } as any);
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
};

const createVerifiedWallet = async (emailSuffix: string, balance = 1000) => {
  const userRepo = AppDataSource.getRepository(User);
  const walletRepo = AppDataSource.getRepository(Wallet);
  const user = await userRepo.save(
    userRepo.create({
      firstName: 'Test',
      lastName: 'User',
      email: `phase4-${emailSuffix}@example.com`,
      phoneNumber: `+23480${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`,
      gender: 'other',
      password: 'hashed-password',
      isVerified: true,
      isKYCVerified: true,
      accountTier: 'APPROVED',
    })
  );
  const wallet = await walletRepo.save(
    walletRepo.create({
      user,
      currency: 'NGN',
      NGN: balance,
      balance,
      availableBalance: balance,
      pendingBalance: 0,
      ledgerBalance: balance,
    })
  );
  return { user, wallet };
};

withPostgres('migrations apply cleanly on PostgreSQL', async () => {
  await initDb();
  const migrations = await AppDataSource.showMigrations();
  assert.equal(migrations, false);
});

withPostgres('concurrent wallet debits cannot overdraw the same wallet', async () => {
  await initDb();
  const { user, wallet } = await createVerifiedWallet('concurrency', 100);
  await Promise.allSettled([
    ledgerService.placeExternalDebitHold({
      walletId: wallet.id,
      userId: user.id,
      amount: 80,
      currency: 'NGN',
      idempotencyKey: 'concurrent-debit-a',
      type: 'withdrawal',
      holdType: 'WITHDRAWAL_HOLD',
    }),
    ledgerService.placeExternalDebitHold({
      walletId: wallet.id,
      userId: user.id,
      amount: 80,
      currency: 'NGN',
      idempotencyKey: 'concurrent-debit-b',
      type: 'withdrawal',
      holdType: 'WITHDRAWAL_HOLD',
    }),
  ]);

  const refreshed = await AppDataSource.getRepository(Wallet).findOneByOrFail({ id: wallet.id });
  assert.equal(Number(refreshed.availableBalance), 20);
  assert.equal(Number(refreshed.pendingBalance), 80);
});

withPostgres('duplicate provider reference cannot double-credit deposit', async () => {
  await initDb();
  const { user, wallet } = await createVerifiedWallet('webhook', 0);
  const input = {
    walletId: wallet.id,
    userId: user.id,
    amount: 250,
    currency: 'NGN' as const,
    provider: 'maplerad',
    providerReference: 'deposit-duplicate-reference',
    providerStatus: 'success',
  };
  await ledgerService.creditDeposit(input);
  const duplicate = await ledgerService.creditDeposit(input);

  const refreshed = await AppDataSource.getRepository(Wallet).findOneByOrFail({ id: wallet.id });
  assert.equal(duplicate.duplicate, true);
  assert.equal(Number(refreshed.availableBalance), 250);
});

withPostgres('duplicate idempotency key cannot double-debit withdrawal hold', async () => {
  await initDb();
  const { user, wallet } = await createVerifiedWallet('idempotency', 500);
  const input = {
    walletId: wallet.id,
    userId: user.id,
    amount: 125,
    currency: 'NGN' as const,
    idempotencyKey: 'withdrawal-idempotency-key',
    type: 'withdrawal' as const,
    holdType: 'WITHDRAWAL_HOLD' as const,
  };
  await ledgerService.placeExternalDebitHold(input);
  const duplicate = await ledgerService.placeExternalDebitHold(input);

  const refreshed = await AppDataSource.getRepository(Wallet).findOneByOrFail({ id: wallet.id });
  assert.equal(duplicate.duplicate, true);
  assert.equal(Number(refreshed.availableBalance), 375);
  assert.equal(Number(refreshed.pendingBalance), 125);
});

withPostgres('reconciliation does not double settle or reverse terminal transactions', async () => {
  await initDb();
  const { user, wallet } = await createVerifiedWallet('reconciliation', 500);
  const hold = await ledgerService.placeExternalDebitHold({
    walletId: wallet.id,
    userId: user.id,
    amount: 100,
    currency: 'NGN',
    idempotencyKey: 'reconciliation-hold',
    type: 'withdrawal',
    holdType: 'WITHDRAWAL_HOLD',
  });
  await ledgerService.markExternalSuccess(hold.transaction.id, 'reconciliation-provider-ref', 'success');

  const transaction = await AppDataSource.getRepository(Transaction).findOneByOrFail({ id: hold.transaction.id });
  const maplerad = require('../services/mapleradService');
  const original = maplerad.MapleRadService.prototype.getProviderTransactionStatus;
  maplerad.MapleRadService.prototype.getProviderTransactionStatus = async () => ({
    id: 'provider-status-id',
    status: 'failed',
  });
  try {
    const reconciled = await reconciliationService.reconcileTransaction(transaction);
    assert.equal(reconciled.reconciliationStatus, 'MISMATCHED');
    const refreshed = await AppDataSource.getRepository(Wallet).findOneByOrFail({ id: wallet.id });
    assert.equal(Number(refreshed.availableBalance), 400);
    assert.equal(Number(refreshed.pendingBalance), 0);
  } finally {
    maplerad.MapleRadService.prototype.getProviderTransactionStatus = original;
  }
});

withPostgres('ledger and audit immutability triggers reject updates', async () => {
  await initDb();
  const { user, wallet } = await createVerifiedWallet('immutability', 100);
  await ledgerService.placeExternalDebitHold({
    walletId: wallet.id,
    userId: user.id,
    amount: 25,
    currency: 'NGN',
    idempotencyKey: 'immutability-hold',
    type: 'withdrawal',
    holdType: 'WITHDRAWAL_HOLD',
  });
  await AppDataSource.getRepository(AuditLog).save(
    AppDataSource.getRepository(AuditLog).create({
      action: 'IMMUTABILITY_TEST',
      entityType: 'Test',
    })
  );

  const journal = await AppDataSource.getRepository(LedgerJournal).createQueryBuilder('journal').getOneOrFail();
  const entry = await AppDataSource.getRepository(LedgerEntry).createQueryBuilder('entry').getOneOrFail();
  const audit = await AppDataSource.getRepository(AuditLog).createQueryBuilder('audit').getOneOrFail();

  await assert.rejects(
    () => AppDataSource.query('UPDATE "ledger_journal" SET "type" = $1 WHERE "id" = $2', ['TRANSFER', journal.id]),
    /immutable/
  );
  await assert.rejects(
    () => AppDataSource.query('UPDATE "ledger_entry" SET "debit" = $1 WHERE "id" = $2', [1, entry.id]),
    /immutable/
  );
  await assert.rejects(
    () => AppDataSource.query('UPDATE "audit_log" SET "action" = $1 WHERE "id" = $2', ['MUTATED', audit.id]),
    /immutable/
  );
});

test.after(async () => {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
});
