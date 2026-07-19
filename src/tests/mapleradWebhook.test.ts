import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { MapleRadService } from '../services/mapleradService';

const webhookSecret = `whsec_${Buffer.from('papafi-test-webhook-secret').toString('base64')}`;

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
  process.env.MAPLERAD_WEBHOOK_SECRET = webhookSecret;
  process.env.MAPLERAD_SECRET_KEY = 'sk_test_docs_only';
  process.env.MAPLERAD_PUBLIC_KEY = 'pk_test_docs_only';
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

test('Maplerad Svix webhook signature rejects stale timestamps', () => {
  const body = JSON.stringify({ id: 'evt_stale', event: 'collection.successful', data: { reference: 'ref_stale' } });
  const staleTimestamp = Math.floor(Date.now() / 1000) - 301;
  assert.equal(service().verifyWebhookSignature(signedHeaders(body, staleTimestamp), body), false);
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
