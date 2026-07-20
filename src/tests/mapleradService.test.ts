import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMapleradProviderError,
  mapleradErrorToHttpStatus,
  MapleradProviderError,
  MapleRadService,
} from '../services/mapleradService';

function serviceWithMockedRequest(mock: (options: any) => Promise<any>) {
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sk_test_docs_only';
  process.env.MAPLERAD_SANDBOX_PUBLIC_KEY = 'pk_test_docs_only';
  process.env.MAPLERAD_SANDBOX_WEBHOOK_SECRET = 'whsec_cGFwYWZpLXRlc3Q=';
  process.env.MAPLERAD_BASE_URL = 'https://api.maplerad.com/v1';
  const service = new MapleRadService();
  (service as any).requestMaplerad = mock;
  return service;
}

test('verifyBvn sends documented payload and returns success response', async () => {
  let observed: any;
  const service = serviceWithMockedRequest(async (options) => {
    observed = options;
    return { status: 'success', id: 'identity-id', first_name: 'Ada' };
  });

  const result = await service.verifyBvn(' 12345678901 ');
  assert.equal(observed.operation, 'maplerad.identity.verify_bvn');
  assert.equal(observed.method, 'POST');
  assert.equal(observed.path, '/identity/bvn');
  assert.deepEqual(observed.payload, { bvn: '12345678901' });
  assert.equal(result.status, 'success');
});

test('verifyBvn maps provider 400 validation errors without leaking BVN', async () => {
  const service = serviceWithMockedRequest(async () => {
    throw new MapleradProviderError(
      'maplerad.identity.verify_bvn failed with Maplerad status 400: invalid bvn',
      'maplerad.identity.verify_bvn',
      400,
      'invalid bvn',
      'req-400',
      { message: 'invalid bvn', bvn: '[redacted]' },
      'VALIDATION'
    );
  });

  await assert.rejects(service.verifyBvn('12345678901'), (error: any) => {
    assert.equal(isMapleradProviderError(error), true);
    assert.equal(error.providerStatus, 400);
    assert.equal(error.providerMessage, 'invalid bvn');
    assert.equal(error.requestId, 'req-400');
    assert.equal(mapleradErrorToHttpStatus(error), 400);
    assert.equal(JSON.stringify(error).includes('12345678901'), false);
    return true;
  });
});

test('verifyBvn maps provider 401 authentication errors to upstream failure status', async () => {
  const service = serviceWithMockedRequest(async () => {
    throw new MapleradProviderError(
      'maplerad.identity.verify_bvn failed with Maplerad status 401: Access Denied',
      'maplerad.identity.verify_bvn',
      401,
      'Access Denied',
      'req-401',
      { message: 'Access Denied' },
      'AUTH'
    );
  });

  await assert.rejects(service.verifyBvn('12345678901'), (error: any) => {
    assert.equal(error.code, 'AUTH');
    assert.equal(mapleradErrorToHttpStatus(error), 502);
    return true;
  });
});

test('verifyBvn maps provider timeout as provider unavailable', async () => {
  const service = serviceWithMockedRequest(async () => {
    throw new MapleradProviderError(
      'maplerad.identity.verify_bvn timed out',
      'maplerad.identity.verify_bvn',
      undefined,
      undefined,
      'req-timeout',
      undefined,
      'TIMEOUT'
    );
  });

  await assert.rejects(service.verifyBvn('12345678901'), (error: any) => {
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(mapleradErrorToHttpStatus(error), 502);
    return true;
  });
});

test('verifyBvn rejects malformed provider response', async () => {
  const service = serviceWithMockedRequest(async () => null);

  await assert.rejects(service.verifyBvn('12345678901'), (error: any) => {
    assert.equal(isMapleradProviderError(error), true);
    assert.equal(error.code, 'SCHEMA');
    assert.equal(mapleradErrorToHttpStatus(error), 502);
    return true;
  });
});
