import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapleradErrorToApplicationCode,
  isMapleradProviderError,
  mapleradErrorToHttpStatus,
  MapleradProviderError,
  MapleRadService,
} from '../services/mapleradService';
import { AppDataSource } from '../database';

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

test('ensureCustomerTier1ForBvn upgrades existing Maplerad customer and re-fetches tier status', async () => {
  const service = serviceWithMockedRequest(async () => null, false);
  const calls: any[] = [];
  const originalTransaction = AppDataSource.transaction.bind(AppDataSource);
  const user = { id: 'user-1', phoneNumber: '+2348012345678' };
  const manager: any = {
    getRepository: (entity: any) => ({
      createQueryBuilder: () => ({
        where: () => ({ setLock: () => ({ getOne: async () => user }) }),
      }),
      findOne: async () => ({ id: 'profile-1', dateOfBirth: '1990-01-31', address: '12 Example Road', country: 'NG' }),
      create: (value: any) => value,
      save: async (value: any) => value,
    }),
  };
  (AppDataSource as any).transaction = async (callback: any) => callback(manager);
  (service as any).ensureMapleRadCustomerForUser = async () => 'cus_1';
  (service as any).getCustomerById = async (customerId: string) => {
    calls.push({ type: 'get', customerId });
    return calls.filter((call) => call.type === 'get').length === 1
      ? { id: customerId, tier: '0' }
      : { id: customerId, tier: '1' };
  };
  (service as any).upgradeCustomerTier1 = async (payload: any) => {
    calls.push({ type: 'upgrade', payload });
    return { status: true };
  };

  try {
    const result = await service.ensureCustomerTier1ForBvn('user-1', {
      bvn: '12345678901',
      city: 'Ikeja',
      state: 'Lagos',
      postalCode: '100001',
    });
    assert.equal(result.tier1, true);
  } finally {
    (AppDataSource as any).transaction = originalTransaction;
  }

  const upgrade = calls.find((call) => call.type === 'upgrade');
  assert.deepEqual(upgrade.payload, {
    customer_id: 'cus_1',
    dob: '31-01-1990',
    identification_number: '12345678901',
    phone: { phone_country_code: '+234', phone_number: '8012345678' },
    address: {
      street: '12 Example Road',
      street2: null,
      city: 'Ikeja',
      state: 'Lagos',
      country: 'NG',
      postal_code: '100001',
    },
  });
  assert.deepEqual(calls.filter((call) => call.type === 'get').map((call) => call.customerId), ['cus_1', 'cus_1']);
});

test('createVirtualAccountForUser sends top-level customer_id after Tier 1 preflight', async () => {
  const service = serviceWithMockedRequest(async () => null, false);
  const originalTransaction = AppDataSource.transaction.bind(AppDataSource);
  let observed: any;
  const user = { id: 'user-1' };
  const walletRepo: any = {
    findOne: async () => null,
    create: (value: any) => value,
    save: async (value: any) => value,
  };
  const referenceRepo: any = {
    findOne: async () => null,
    create: (value: any) => value,
    save: async (value: any) => value,
  };
  const manager: any = {
    getRepository: (entity: any) => {
      if (entity?.name === 'Wallet') return walletRepo;
      if (entity?.name === 'ProviderReference') return referenceRepo;
      return {
        createQueryBuilder: () => ({
          where: () => ({ setLock: () => ({ getOne: async () => user }) }),
        }),
      };
    },
  };
  (AppDataSource as any).transaction = async (callback: any) => callback(manager);
  (service as any).ensureMapleRadCustomerForUser = async () => 'cus_1';
  (service as any).getCustomerById = async () => ({ id: 'cus_1', tier: '1' });
  (service as any).getCustomerVirtualAccounts = async () => [];
  (service as any).requestMaplerad = async (options: any) => {
    observed = options;
    return { id: 'acct_1', account_number: '1234567890', bank_name: 'Test Bank', currency: 'NGN' };
  };

  try {
    await service.createVirtualAccountForUser('user-1', 'NGN');
  } finally {
    (AppDataSource as any).transaction = originalTransaction;
  }

  assert.equal(observed.operation, 'maplerad.virtual_account.create');
  assert.equal(observed.path, '/collections/virtual-account');
  assert.deepEqual(observed.payload, { customer_id: 'cus_1', currency: 'NGN' });
});

test('Tier 0 virtual account failure maps to CUSTOMER_NOT_TIER1 response', async () => {
  const error = new MapleradProviderError(
    'maplerad.virtual_account.create failed with Maplerad status 400: service is only available for Tier 1 customers',
    'maplerad.virtual_account.create',
    400,
    'service is only available for Tier 1 customers',
    'req-tier',
    { message: 'service is only available for Tier 1 customers' },
    'VALIDATION'
  );

  assert.equal(mapleradErrorToApplicationCode(error), 'CUSTOMER_NOT_TIER1');
  assert.equal(mapleradErrorToHttpStatus(error), 400);
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
