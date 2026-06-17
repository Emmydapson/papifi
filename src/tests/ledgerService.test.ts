import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateHoldBalances,
  calculatePendingReleaseBalances,
  calculatePendingReversalBalances,
  validateBalancedEntries,
} from '../services/ledgerService';
import { assertDailyLimit, assertWithinLimit } from '../services/limitService';
import { sanitizeAuditMetadata } from '../services/auditService';
import { isLargeTransaction } from '../services/riskService';
import { safeTransactionResponse } from '../controllers/adminController';

test('double-entry journal accepts balanced debit and credit entries', () => {
  assert.doesNotThrow(() =>
    validateBalancedEntries([
      { debit: 100, credit: 0 },
      { debit: 0, credit: 100 },
    ])
  );
});

test('double-entry journal rejects unbalanced entries', () => {
  assert.throws(
    () =>
      validateBalancedEntries([
        { debit: 100, credit: 0 },
        { debit: 0, credit: 90 },
      ]),
    /Unbalanced ledger journal/
  );
});

test('double-entry journal rejects entries with both debit and credit', () => {
  assert.throws(
    () =>
      validateBalancedEntries([
        { debit: 100, credit: 100 },
        { debit: 0, credit: 100 },
      ]),
    /both debit and credit/
  );
});

test('hold balances prevent overdraft and keep ledger balance aligned', () => {
  assert.throws(() => calculateHoldBalances(50, 0, 60), /Insufficient balance/);

  const balances = calculateHoldBalances(100, 10, 30);
  assert.equal(balances.availableBalance, 70);
  assert.equal(balances.pendingBalance, 40);
  assert.equal(balances.ledgerBalance, balances.availableBalance + balances.pendingBalance);
});

test('failed withdrawal reversal releases pending funds back to available', () => {
  const balances = calculatePendingReversalBalances(70, 30, 30);
  assert.equal(balances.availableBalance, 100);
  assert.equal(balances.pendingBalance, 0);
  assert.equal(balances.ledgerBalance, 100);
  assert.throws(() => calculatePendingReversalBalances(70, 10, 30), /Pending balance is insufficient/);
});

test('successful external settlement removes pending funds without increasing available', () => {
  const balances = calculatePendingReleaseBalances(70, 30, 30);
  assert.equal(balances.availableBalance, 70);
  assert.equal(balances.pendingBalance, 0);
  assert.equal(balances.ledgerBalance, 70);
});

test('limit helper rejects per transaction and daily limit excesses', () => {
  assert.throws(() => assertWithinLimit(1000, 0, 500, 'withdrawal'), /per-transaction|daily/);
  assert.throws(() => assertWithinLimit(400, 200, 500, 'withdrawal'), /daily limit/);
  assert.doesNotThrow(() => assertWithinLimit(300, 100, 500, 'withdrawal'));
});

test('total daily debit limit uses aggregate debit usage without per-transaction comparison', () => {
  assert.throws(() => assertDailyLimit(300, 600, 800, 'total daily debit'), /daily limit/);
  assert.doesNotThrow(() => assertDailyLimit(900, 0, 1000, 'total daily debit'));
});

test('audit metadata sanitizer redacts secrets and card data recursively', () => {
  const sanitized = sanitizeAuditMetadata({
    transactionPin: '1234',
    authorization: 'Bearer token',
    providerPayload: { reference: 'provider-ref', nested: { status: 'success' } },
    nested: { otp: '111111', cardNumber: '4111111111111111', signature: 'signed', bvn: '22222222222', safe: 'ok' },
  });
  assert.equal(sanitized.transactionPin, '[redacted]');
  assert.equal(sanitized.authorization, '[redacted]');
  assert.equal(sanitized.providerPayload, '[redacted]');
  assert.equal(sanitized.nested.otp, '[redacted]');
  assert.equal(sanitized.nested.cardNumber, '[redacted]');
  assert.equal(sanitized.nested.signature, '[redacted]');
  assert.equal(sanitized.nested.bvn, '[redacted]');
  assert.equal(sanitized.nested.safe, 'ok');
});

test('admin transaction response omits provider payload', () => {
  const response = safeTransactionResponse({
    id: 'tx-1',
    amount: 100,
    currency: 'NGN',
    type: 'withdrawal',
    status: 'PROCESSING',
    reference: 'local-ref',
    provider: 'maplerad',
    providerReference: 'provider-ref',
    providerStatus: 'processing',
    providerPayload: { secret: 'value', authorization: 'Bearer token' },
    reconciliationStatus: 'PENDING',
    createdAt: new Date(),
  } as any);
  assert.equal(Object.prototype.hasOwnProperty.call(response, 'providerPayload'), false);
  assert.equal(response.providerReference, 'provider-ref');
});

test('large transaction risk threshold is configurable by default', () => {
  assert.equal(isLargeTransaction(1000000), true);
  assert.equal(isLargeTransaction(1000), false);
});
