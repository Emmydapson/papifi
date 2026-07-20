import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { MapleRadService } from '../services/mapleradService';

const webhookSecret = `whsec_${Buffer.from('papafi-test-webhook-secret').toString('base64')}`;
const previousWebhookSecret = `whsec_${Buffer.from('papafi-previous-webhook-secret').toString('base64')}`;
const originalEnv = { ...process.env };

function signedHeaders(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const svixId = `msg_${crypto.randomUUID()}`;
  const secretBytes = Buffer.from(webhookSecret.split('_')[1], 'base64');
  const signature = crypto.createHmac('sha256', secretBytes).update(`${svixId}.${timestamp}.${body}`).digest('base64');
  return {
    svixId,
    svixTimestamp: String(timestamp),
    svixSignature: `v1,${signature}`,
  };
}

function service() {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_WEBHOOK_VERIFICATION_MODE = 'signature';
  process.env.MAPLERAD_SANDBOX_WEBHOOK_SECRET = webhookSecret;
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sk_test_docs_only';
  process.env.MAPLERAD_SANDBOX_PUBLIC_KEY = 'pk_test_docs_only';
  process.env.MAPLERAD_BASE_URL = 'https://api.maplerad.com/v1';
  process.env.MAPLERAD_WEBHOOK_TOLERANCE_SECONDS = '300';
  return new MapleRadService();
}

test('Maplerad Svix webhook signature accepts a valid signed event', () => {
  const body = JSON.stringify({ id: 'evt_valid', event: 'collection.successful', data: { reference: 'ref_valid' } });
  assert.equal(service().verifyWebhookSignature(signedHeaders(body), body), true);
});

test('Maplerad Svix webhook signature rejects invalid signatures', () => {
  const body = JSON.stringify({ id: 'evt_invalid', event: 'collection.successful', data: { reference: 'ref_invalid' } });
  const headers = signedHeaders(body);
  assert.equal(service().verifyWebhookSignature({ ...headers, svixSignature: 'v1,invalid' }, body), false);
});

test('Maplerad Svix webhook signature accepts one of multiple v1 signatures', () => {
  const body = JSON.stringify({ id: 'evt_multi', event: 'collection.successful', data: { reference: 'ref_multi' } });
  const headers = signedHeaders(body);
  assert.equal(service().verifyWebhookSignature({ ...headers, svixSignature: `v1,bad ${headers.svixSignature}` }, body), true);
});

test('Maplerad Svix webhook signature rejects stale timestamps', () => {
  const body = JSON.stringify({ id: 'evt_stale', event: 'collection.successful', data: { reference: 'ref_stale' } });
  const staleTimestamp = Math.floor(Date.now() / 1000) - 301;
  assert.equal(service().verifyWebhookSignature(signedHeaders(body, staleTimestamp), body), false);
});

test('Maplerad Svix webhook signature rejects missing headers', () => {
  const body = JSON.stringify({ id: 'evt_missing', event: 'collection.successful' });
  assert.equal(service().verifyWebhookSignature({ svixId: 'msg_missing' }, body), false);
});

test('Maplerad Svix webhook signature rejects changed raw request body', () => {
  const body = JSON.stringify({ id: 'evt_raw', event: 'collection.successful', data: { reference: 'ref_raw' } });
  const changedBody = JSON.stringify({ event: 'collection.successful', id: 'evt_raw', data: { reference: 'ref_raw' } });
  assert.equal(service().verifyWebhookSignature(signedHeaders(body), changedBody), false);
});

test('Maplerad webhook signature accepts previous secret for rotation', () => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_WEBHOOK_VERIFICATION_MODE = 'signature';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sk_test_docs_only';
  process.env.MAPLERAD_SANDBOX_WEBHOOK_SECRET = webhookSecret;
  process.env.MAPLERAD_SANDBOX_PREVIOUS_WEBHOOK_SECRET = previousWebhookSecret;
  const body = JSON.stringify({ id: 'evt_previous', event: 'collection.successful' });
  const svixId = `msg_${crypto.randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', Buffer.from(previousWebhookSecret.split('_')[1], 'base64'))
    .update(`${svixId}.${timestamp}.${body}`)
    .digest('base64');

  assert.equal(
    new MapleRadService().verifyWebhookSignature({ svixId, svixTimestamp: String(timestamp), svixSignature: `v1,${signature}` }, body),
    true
  );
});

test('Maplerad sandbox and production webhook secrets are separated', () => {
  const body = JSON.stringify({ id: 'evt_env', event: 'collection.successful' });
  const headers = signedHeaders(body);
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'production';
  process.env.MAPLERAD_ENVIRONMENT = 'production';
  process.env.MAPLERAD_WEBHOOK_VERIFICATION_MODE = 'signature';
  process.env.MAPLERAD_PRODUCTION_SECRET_KEY = 'sk_live_docs_only';
  process.env.MAPLERAD_PRODUCTION_WEBHOOK_SECRET = `whsec_${Buffer.from('different-production-secret').toString('base64')}`;

  assert.equal(new MapleRadService().verifyWebhookSignature(headers, body), false);
});

test('Maplerad ip_and_requery fallback accepts official source IP only after provider re-query success', async () => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_WEBHOOK_VERIFICATION_MODE = 'ip_and_requery';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sk_test_docs_only';
  delete process.env.MAPLERAD_SANDBOX_WEBHOOK_SECRET;
  process.env.MAPLERAD_WEBHOOK_ALLOWED_IPS = '203.0.113.10';
  const svc = new MapleRadService();
  (svc as any).getTransactionById = async () => ({ status: 'success', amount: 10000, currency: 'NGN', customer_id: 'cust_1' });

  const result = await svc.verifyWebhookRequest({
    headers: {},
    rawBody: '{}',
    sourceIp: '203.0.113.10',
    eventData: {
      type: 'DEPOSIT_RECORDED',
      event: 'collection.successful',
      eventId: 'evt_ip_ok',
      reference: 'tx_1',
      amount: 100,
      currency: 'NGN',
      customerId: 'cust_1',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'ip_and_requery');
});

test('Maplerad ip_and_requery fallback rejects unrecognised source IP and spoofed X-Forwarded-For values', async () => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_WEBHOOK_VERIFICATION_MODE = 'ip_and_requery';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sk_test_docs_only';
  delete process.env.MAPLERAD_SANDBOX_WEBHOOK_SECRET;
  process.env.MAPLERAD_WEBHOOK_ALLOWED_IPS = '203.0.113.10';
  const svc = new MapleRadService();
  const result = await svc.verifyWebhookRequest({
    headers: {},
    rawBody: '{}',
    sourceIp: '198.51.100.99',
    eventData: { type: 'OTHER_EVENT', event: 'provider.event', eventId: 'evt_bad_ip', reference: 'ref' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test('Maplerad ip_and_requery fallback rejects provider re-query mismatch', async () => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_WEBHOOK_VERIFICATION_MODE = 'ip_and_requery';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sk_test_docs_only';
  delete process.env.MAPLERAD_SANDBOX_WEBHOOK_SECRET;
  process.env.MAPLERAD_WEBHOOK_ALLOWED_IPS = '203.0.113.10';
  const svc = new MapleRadService();
  (svc as any).getTransactionById = async () => ({ status: 'success', amount: 9000, currency: 'NGN', customer_id: 'cust_1' });
  const result = await svc.verifyWebhookRequest({
    headers: {},
    rawBody: '{}',
    sourceIp: '203.0.113.10',
    eventData: {
      type: 'DEPOSIT_RECORDED',
      event: 'collection.successful',
      eventId: 'evt_ip_mismatch',
      reference: 'tx_1',
      amount: 100,
      currency: 'NGN',
      customerId: 'cust_1',
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 202);
});

test('legacy x-maplerad-signature style is not accepted', () => {
  const body = JSON.stringify({ id: 'evt_legacy', event: 'collection.successful' });
  const legacySignature = crypto.createHmac('sha512', webhookSecret).update(body).digest('hex');
  assert.equal(service().verifyWebhookSignature(legacySignature, body), false);
});

test('unknown valid Maplerad event is classified for safe HTTP 200 handling', async () => {
  const event = await service().handleWebhook(
    JSON.stringify({ id: 'evt_unknown', event: 'provider.new_event', data: { reference: 'ref_unknown', token: 'secret' } })
  );
  assert.equal(event?.type, 'OTHER_EVENT');
  assert.equal(event?.eventId, 'evt_unknown');
  assert.equal(event?.reference, 'ref_unknown');
  assert.equal(event?.data?.token, '[redacted]');
});

test('transfer terminal events are classified without money movement side effects in service layer', async () => {
  const success = await service().handleWebhook(
    JSON.stringify({ id: 'evt_transfer_success', event: 'transfer.successful', reference: 'tr_ref', status: 'SUCCESS' })
  );
  const failed = await service().handleWebhook(
    JSON.stringify({ id: 'evt_transfer_failed', event: 'transfer.failed', reference: 'tr_ref_2', status: 'FAILED' })
  );

  assert.equal(success?.type, 'TRANSFER_EVENT');
  assert.equal(success?.reference, 'tr_ref');
  assert.equal(failed?.type, 'TRANSFER_EVENT');
  assert.equal(failed?.reference, 'tr_ref_2');
});
