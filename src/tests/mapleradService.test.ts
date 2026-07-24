import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapleradErrorToApplicationCode,
  isMapleradProviderError,
  mapleradErrorToHttpStatus,
  MapleradProviderError,
  MapleRadService,
} from '../services/mapleradService';

function serviceWithMockedRequest(mock: (options: any) => Promise<any>, raw = true) {
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sk_test_docs_only';
  process.env.MAPLERAD_SANDBOX_PUBLIC_KEY = 'pk_test_docs_only';
  process.env.MAPLERAD_SANDBOX_WEBHOOK_SECRET = 'whsec_cGFwYWZpLXRlc3Q=';
  process.env.MAPLERAD_BASE_URL = 'https://api.maplerad.com/v1';
  const service = new MapleRadService();
  if (raw) {
    (service as any).requestMapleradRaw = async (options: any) => {
      const result = await mock(options);
      if (typeof result?.status === 'number' && Object.prototype.hasOwnProperty.call(result, 'data')) return result;
      return { status: 200, data: result, headers: { 'x-request-id': 'req-success' } };
    };
  } else {
    (service as any).requestMaplerad = mock;
  }
  return service;
}

test('verifyBvn sends documented payload and returns success response', async () => {
  let observed: any;
  const service = serviceWithMockedRequest(async (options) => {
    observed = options;
    return { status: true, message: 'BVN resolved', data: { first_name: 'Ada', last_name: 'Okafor' } };
  }, true);

  const result = await service.verifyBvn(' 12345678901 ');
  assert.equal(observed.operation, 'maplerad.identity.verify_bvn');
  assert.equal(observed.method, 'POST');
  assert.equal(observed.path, '/identity/bvn');
  assert.deepEqual(observed.payload, { bvn: '12345678901' });
  assert.equal(result.verified, true);
  assert.equal(result.applicationCode, 'BVN_VERIFIED');
  assert.equal(result.providerHttpStatus, 200);
  assert.deepEqual(Object.keys(observed.payload), ['bvn']);
  for (const forbidden of ['first_name', 'middle_name', 'last_name', 'phone', 'phone_number', 'dob', 'address', 'email']) {
    assert.equal(Object.prototype.hasOwnProperty.call(observed.payload, forbidden), false);
  }
});

test('verifyBvn validates BVN as exactly 11 digits after trim only', async () => {
  const service = serviceWithMockedRequest(async () => {
    throw new Error('provider should not be called');
  }, true);

  for (const bvn of ['1234567890', '123456789012', '12345 78901', 'abcdefghijk']) {
    await assert.rejects(service.verifyBvn(bvn), (error: any) => {
      assert.equal(isMapleradProviderError(error), true);
      assert.equal(error.code, 'VALIDATION');
      assert.equal(mapleradErrorToApplicationCode(error), 'MAPLERAD_VALIDATION_ERROR');
      return true;
    });
  }
});

test('verifyBvn parses nested successful response envelope', async () => {
  const service = serviceWithMockedRequest(async () => ({
    status: 200,
    headers: { 'x-request-id': 'req-nested' },
    data: {
      status: true,
      message: 'BVN verified',
      data: { first_name: 'Ada', last_name: 'Okafor' },
    },
  }), true);

  const result = await service.verifyBvn('12345678901');
  assert.equal(result.verified, true);
  assert.equal(result.providerRequestId, 'req-nested');
  assert.deepEqual(result.responseKeys, ['data', 'message', 'status']);
  assert.deepEqual(result.dataKeys, ['first_name', 'last_name']);
});

test('verifyBvn treats Maplerad status true with identity data as successful', async () => {
  const service = serviceWithMockedRequest(async () => ({
    status: 200,
    headers: { 'x-request-id': 'req-status-true' },
    data: {
      status: true,
      message: 'BVN resolved',
      data: {
        first_name: 'John',
        middle_name: 'Victoria',
        last_name: 'Doe',
        dob: '1994-01-10',
        phone_number: '08000000000',
        gender: 'Male',
        image: 'base64-image-data',
      },
    },
  }), true);

  const result = await service.verifyBvn('12345678901');
  assert.equal(result.verified, true);
  assert.equal(result.provider, 'maplerad');
  assert.equal(result.providerEnvironment, 'sandbox');
  assert.equal(result.providerStatus, true);
  assert.equal(result.identity?.firstName, 'John');
  assert.equal(result.identity?.dateOfBirth, '1994-01-10');
  assert.equal(result.identity?.image, 'base64-image-data');
});

test('verifyBvn maps 400 insufficient balance to provider account problem without leaking BVN', async () => {
  const service = serviceWithMockedRequest(async () => {
    throw new MapleradProviderError(
      'maplerad.identity.verify_bvn failed with Maplerad status 400: insufficient balance',
      'maplerad.identity.verify_bvn',
      400,
      'insufficient balance',
      'req-400',
      { message: 'invalid bvn', bvn: '[redacted]' },
      'ACCOUNT'
    );
  });

  await assert.rejects(service.verifyBvn('12345678901'), (error: any) => {
    assert.equal(isMapleradProviderError(error), true);
    assert.equal(error.providerStatus, 400);
    assert.equal(error.providerMessage, 'insufficient balance');
    assert.equal(error.requestId, 'req-400');
    assert.equal(error.code, 'ACCOUNT');
    assert.equal(mapleradErrorToHttpStatus(error), 503);
    assert.equal(mapleradErrorToApplicationCode(error), 'MAPLERAD_INSUFFICIENT_BALANCE');
    assert.equal(JSON.stringify(error).includes('12345678901'), false);
    return true;
  });
});

test('verifyBvn maps provider validation error without treating it as BVN not verified', async () => {
  const service = serviceWithMockedRequest(async () => {
    throw new MapleradProviderError(
      'maplerad.identity.verify_bvn failed with Maplerad status 400: malformed bvn',
      'maplerad.identity.verify_bvn',
      400,
      'malformed bvn',
      'req-validation',
      { message: 'malformed bvn' },
      'VALIDATION'
    );
  });

  await assert.rejects(service.verifyBvn('12345678901'), (error: any) => {
    assert.equal(mapleradErrorToApplicationCode(error), 'MAPLERAD_VALIDATION_ERROR');
    assert.notEqual(mapleradErrorToApplicationCode(error), 'BVN_NOT_VERIFIED');
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
    assert.equal(mapleradErrorToApplicationCode(error), 'MAPLERAD_AUTHENTICATION_FAILED');
    return true;
  });
});

test('verifyBvn maps provider 403 access errors to configuration failure', async () => {
  const service = serviceWithMockedRequest(async () => {
    throw new MapleradProviderError(
      'maplerad.identity.verify_bvn failed with Maplerad status 403: Access Denied',
      'maplerad.identity.verify_bvn',
      403,
      'Access Denied',
      'req-403',
      { message: 'Access Denied' },
      'AUTH'
    );
  });

  await assert.rejects(service.verifyBvn('12345678901'), (error: any) => {
    assert.equal(mapleradErrorToApplicationCode(error), 'MAPLERAD_CONFIGURATION_ERROR');
    return true;
  });
});

test('verifyBvn maps provider 429 to rate limiting', async () => {
  const service = serviceWithMockedRequest(async () => {
    throw new MapleradProviderError(
      'maplerad.identity.verify_bvn failed with Maplerad status 429',
      'maplerad.identity.verify_bvn',
      429,
      'rate limited',
      'req-429',
      { message: 'rate limited' },
      'RATE_LIMIT'
    );
  });

  await assert.rejects(service.verifyBvn('12345678901'), (error: any) => {
    assert.equal(mapleradErrorToHttpStatus(error), 429);
    assert.equal(mapleradErrorToApplicationCode(error), 'MAPLERAD_RATE_LIMITED');
    return true;
  });
});

test('verifyBvn maps 5xx provider errors to unavailable', async () => {
  const service = serviceWithMockedRequest(async () => {
    throw new MapleradProviderError(
      'maplerad.identity.verify_bvn failed with Maplerad status 500',
      'maplerad.identity.verify_bvn',
      500,
      'internal provider error',
      'req-500',
      { message: 'internal provider error' },
      'PROVIDER'
    );
  });

  await assert.rejects(service.verifyBvn('12345678901'), (error: any) => {
    assert.equal(mapleradErrorToHttpStatus(error), 502);
    assert.equal(mapleradErrorToApplicationCode(error), 'MAPLERAD_UNAVAILABLE');
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
    assert.equal(mapleradErrorToApplicationCode(error), 'MAPLERAD_UNAVAILABLE');
    return true;
  });
});

test('verifyBvn rejects unknown 200 provider response as contract error', async () => {
  const service = serviceWithMockedRequest(async () => ({ status: 200, data: { message: 'ok' }, headers: {} }), true);

  await assert.rejects(service.verifyBvn('12345678901'), (error: any) => {
    assert.equal(isMapleradProviderError(error), true);
    assert.equal(error.code, 'SCHEMA');
    assert.equal(mapleradErrorToHttpStatus(error), 502);
    assert.equal(mapleradErrorToApplicationCode(error), 'MAPLERAD_CONTRACT_ERROR');
    return true;
  });
});

test('verifyBvn maps explicitly invalid/not-found successful provider response to BVN_NOT_VERIFIED', async () => {
  const service = serviceWithMockedRequest(async () => ({
    status: 200,
    headers: { 'x-request-id': 'req-invalid' },
    data: { status: 'failed', message: 'BVN not found', data: { verified: false } },
  }), true);

  const result = await service.verifyBvn('12345678901');
  assert.equal(result.verified, false);
  assert.equal(result.applicationCode, 'BVN_NOT_VERIFIED');
  assert.equal(result.providerRequestId, 'req-invalid');
});

test('provider request failure logs safe metadata only', async () => {
  const service = serviceWithMockedRequest(async () => null, false);
  const logs: string[] = [];
  const originalError = console.error;
  console.error = (line?: any) => {
    logs.push(String(line));
  };
  try {
    (service as any).http = {
      request: async () => {
        const error: any = new Error('Request failed');
        error.response = {
          status: 400,
          data: { message: 'invalid bvn', bvn: '12345678901', first_name: 'Ada' },
          headers: { 'x-request-id': 'req-log' },
        };
        error.config = { method: 'POST', url: '/identity/bvn' };
        throw error;
      },
    };

    await assert.rejects(service.verifyBvn('12345678901'));
  } finally {
    console.error = originalError;
  }

  const joined = logs.join('\n');
  assert.match(joined, /maplerad_provider_request_failed/);
  assert.doesNotMatch(joined, /12345678901/);
  assert.doesNotMatch(joined, /Ada/);
});

test('ensureMapleRadCustomer reuses existing reference instead of creating duplicates', async () => {
  const service = serviceWithMockedRequest(async () => null);
  const calls: string[] = [];
  const user = { id: 'user-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Okafor' };
  const reference = { providerCustomerId: 'cus_existing' };
  const manager: any = {
    getRepository: (entity: any) => ({
      createQueryBuilder: () => ({
        where: () => ({ setLock: () => ({ getOne: async () => user }) }),
      }),
      findOne: async () => reference,
      create: (value: any) => value,
      save: async (value: any) => value,
    }),
  };
  (service as any).getCustomerById = async (customerId: string) => {
    calls.push(customerId);
    return { id: customerId, email: user.email, first_name: user.firstName, last_name: user.lastName };
  };
  (service as any).requestMaplerad = async () => {
    throw new Error('customer create should not be called');
  };

  const customerId = await (service as any).ensureMapleRadCustomerForUser(user.id, manager);
  assert.equal(customerId, 'cus_existing');
  assert.deepEqual(calls, ['cus_existing']);
});

test('identity-name normalization preserves surname field semantics', () => {
  const service = serviceWithMockedRequest(async () => null);
  assert.equal(service.normalizeIdentityName('  O.KA-FOR  '), 'okafor');
  const match = (service as any).validateCustomerMatch(
    { email: 'ada@example.com', firstName: 'Ada Ngozi', lastName: 'Okafor' },
    { id: 'cus_1', email: 'ada@example.com', first_name: 'Ngozi Ada', last_name: 'Okafor' }
  );
  assert.equal(match.ok, false);
  assert.deepEqual(match.mismatches, ['first_name']);
});

test('Nigerian phone normalization handles local and E.164-like forms', () => {
  const service = serviceWithMockedRequest(async () => null);
  assert.equal(service.normalizeNigerianPhone('08012345678'), '+2348012345678');
  assert.equal(service.normalizeNigerianPhone('2348012345678'), '+2348012345678');
  assert.equal(service.normalizeNigerianPhone('+2348012345678'), '+2348012345678');
});

test('name or phone mismatch is never inferred from insufficient balance', async () => {
  const service = serviceWithMockedRequest(async () => {
    throw new MapleradProviderError(
      'maplerad.identity.verify_bvn failed with Maplerad status 400: insufficient balance',
      'maplerad.identity.verify_bvn',
      400,
      'insufficient balance',
      'req-balance',
      { message: 'insufficient balance' },
      'ACCOUNT'
    );
  });

  await assert.rejects(service.verifyBvn('12345678901'), (error: any) => {
    assert.equal(mapleradErrorToApplicationCode(error), 'MAPLERAD_INSUFFICIENT_BALANCE');
    assert.notEqual(mapleradErrorToApplicationCode(error), 'BVN_IDENTITY_MISMATCH');
    return true;
  });
});

test('Tier 1 upgrade is a separate operation from standalone BVN verification', async () => {
  const operations: string[] = [];
  const service = serviceWithMockedRequest(async (options) => {
    operations.push(options.operation);
    return { status: true, message: 'BVN resolved', data: { first_name: 'Ada', last_name: 'Okafor' } };
  }, true);

  await service.verifyBvn('12345678901');
  assert.deepEqual(operations, ['maplerad.identity.verify_bvn']);
});
