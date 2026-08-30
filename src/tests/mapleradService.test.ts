import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapleradErrorToApplicationCode,
  isMapleradProviderError,
  mapleradErrorToHttpStatus,
  MapleradProviderError,
  MapleradCustomerRecoveryError,
  MapleRadService,
} from '../services/mapleradService';
import { AppDataSource } from '../database';

function customerCreationManager(savedReferences: any[] = []) {
  const user = { id: 'user-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Okafor' };
  const references: any[] = [];
  return {
    user,
    manager: {
      getRepository: (entity: any) => {
        if (entity?.name === 'ProviderReference') {
          return {
            findOne: async () => references[0],
            create: (value: any) => value,
            save: async (value: any) => {
              references[0] = value;
              savedReferences.push(value);
              return value;
            },
          };
        }
        if (entity?.name === 'AuditLog') {
          return {
            create: (value: any) => value,
            save: async (value: any) => value,
          };
        }
        return {
          createQueryBuilder: () => ({
            where: () => ({ setLock: () => ({ getOne: async () => user }) }),
          }),
        };
      },
    },
  };
}

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

test('ensureMapleRadCustomer creates customer and persists extracted customer id', async () => {
  const savedReferences: any[] = [];
  const calls: any[] = [];
  const service = serviceWithMockedRequest(async (options) => {
    calls.push(options);
    return {
      status: 200,
      headers: { 'x-request-id': 'req-customer-create' },
      data: {
        status: true,
        message: 'Customer created',
        data: {
          id: 'cus_created',
          first_name: 'Ada',
          last_name: 'Okafor',
          email: 'ada@example.com',
          country: 'NG',
        },
      },
    };
  }, true);
  const { user, manager } = customerCreationManager(savedReferences);
  (service as any).activeRecoveryCooldown = async () => undefined;

  const customerId = await (service as any).ensureMapleRadCustomerForUser(user.id, manager);

  assert.equal(customerId, 'cus_created');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'maplerad.customer.create');
  assert.deepEqual(calls[0].payload, {
    first_name: 'Ada',
    last_name: 'Okafor',
    email: 'ada@example.com',
    country: 'NG',
  });
  assert.equal(savedReferences[0].providerCustomerId, 'cus_created');
  assert.equal(savedReferences[0].externalReference, 'cus_created');
  assert.equal(savedReferences[0].status, 'active');
});

test('customer creation parser supports data.id response', async () => {
  const service = serviceWithMockedRequest(async () => null);
  const customer = (service as any).parseCustomerCreateResponse({
    status: true,
    message: 'Customer created',
    data: { id: 'cus_data_id', email: 'ada@example.com' },
  });

  assert.equal(customer.id, 'cus_data_id');
  assert.equal(customer.email, 'ada@example.com');
});

test('customer creation parser supports nested customer object response', async () => {
  const service = serviceWithMockedRequest(async () => null);
  const customer = (service as any).parseCustomerCreateResponse({
    status: true,
    message: 'Customer created',
    data: {
      customer: {
        id: 'cus_nested',
        first_name: 'Ada',
      },
    },
  });

  assert.equal(customer.id, 'cus_nested');
  assert.equal(customer.first_name, 'Ada');
});

test('customer creation parser surfaces provider error payload', async () => {
  const service = serviceWithMockedRequest(async () => null);

  assert.throws(
    () =>
      (service as any).parseCustomerCreateResponse({
        status: false,
        message: 'customer already enrolled',
        errors: [{ message: 'email already exists' }],
      }),
    (error: any) => {
      assert.equal(isMapleradProviderError(error), true);
      assert.equal(error.operation, 'maplerad.customer.create');
      assert.equal(error.providerMessage, 'customer already enrolled');
      assert.notEqual(error.providerMessage, 'missing customer id');
      assert.deepEqual(error.safeResponseBody, {
        status: false,
        message: 'customer already enrolled',
        errors: [{ message: 'email already exists' }],
      });
      return true;
    }
  );
});

test('customer creation parser rejects missing id response as contract error', async () => {
  const service = serviceWithMockedRequest(async () => null);

  assert.throws(
    () =>
      (service as any).parseCustomerCreateResponse({
        status: true,
        message: 'Customer created',
        data: { email: 'ada@example.com' },
      }),
    (error: any) => {
      assert.equal(isMapleradProviderError(error), true);
      assert.equal(error.code, 'SCHEMA');
      assert.equal(mapleradErrorToApplicationCode(error), 'MAPLERAD_CONTRACT_ERROR');
      assert.equal(error.providerMessage, 'missing customer id');
      return true;
    }
  );
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

test('enrollMapleradCustomerTier1 returns PROFILE_INCOMPLETE and does not call provider upgrade', async () => {
  const service = serviceWithMockedRequest(async () => null, false);
  const originalTransaction = AppDataSource.transaction.bind(AppDataSource);
  const user = { id: 'user-1', phoneNumber: '+2348012345678' };
  const savedReferences: any[] = [];
  const calls: any[] = [];
  const manager: any = {
    getRepository: (entity: any) => {
      if (entity?.name === 'Profile') {
        return { findOne: async () => ({ id: 'profile-1', dateOfBirth: '1990-01-31', address: '12 Example Road', country: 'NG' }) };
      }
      if (entity?.name === 'ProviderReference') {
        return {
          findOne: async () => undefined,
          create: (value: any) => value,
          save: async (value: any) => {
            savedReferences.push(value);
            return value;
          },
        };
      }
      if (entity?.name === 'AuditLog') return { create: (value: any) => value, save: async (value: any) => value };
      return {
        createQueryBuilder: () => ({
          where: () => ({ setLock: () => ({ getOne: async () => user }) }),
        }),
      };
    },
  };
  (AppDataSource as any).transaction = async (callback: any) => callback(manager);
  (service as any).ensureMapleRadCustomerForUser = async () => 'cus_1';
  (service as any).getCustomerById = async (customerId: string) => ({ id: customerId, tier: '0' });
  (service as any).upgradeCustomerTier1 = async (payload: any) => {
    calls.push(payload);
    return { status: true };
  };

  try {
    const result = await service.enrollMapleradCustomerTier1('user-1', undefined, {
      bvn: '12345678901',
      address: '12 Example Road',
      country: 'NG',
    });
    assert.equal(result.state, 'PROFILE_INCOMPLETE');
    assert.equal(result.tier1, false);
    assert.deepEqual(result.missingFields, ['city', 'state', 'postalCode']);
  } finally {
    (AppDataSource as any).transaction = originalTransaction;
  }

  assert.equal(calls.length, 0);
  assert.equal(savedReferences[0].metadata.tier1EnrollmentState, 'PROFILE_INCOMPLETE');
  assert.deepEqual(savedReferences[0].metadata.missingFields, ['city', 'state', 'postalCode']);
});

test('enrollMapleradCustomerTier1 is idempotent when customer is already Tier 1', async () => {
  const service = serviceWithMockedRequest(async () => null, false);
  const originalTransaction = AppDataSource.transaction.bind(AppDataSource);
  const user = { id: 'user-1', phoneNumber: '+2348012345678' };
  let upgradeCalled = false;
  const manager: any = {
    getRepository: (entity: any) => {
      if (entity?.name === 'Profile') return { findOne: async () => null };
      if (entity?.name === 'ProviderReference') return { findOne: async () => undefined, create: (value: any) => value, save: async (value: any) => value };
      if (entity?.name === 'AuditLog') return { create: (value: any) => value, save: async (value: any) => value };
      return {
        createQueryBuilder: () => ({
          where: () => ({ setLock: () => ({ getOne: async () => user }) }),
        }),
      };
    },
  };
  (AppDataSource as any).transaction = async (callback: any) => callback(manager);
  (service as any).ensureMapleRadCustomerForUser = async () => 'cus_1';
  (service as any).getCustomerById = async (customerId: string) => ({ id: customerId, tier: '1' });
  (service as any).upgradeCustomerTier1 = async () => {
    upgradeCalled = true;
  };

  try {
    const result = await service.enrollMapleradCustomerTier1('user-1', undefined, { bvn: '12345678901' });
    assert.equal(result.state, 'TIER_1');
    assert.equal(result.upgraded, false);
  } finally {
    (AppDataSource as any).transaction = originalTransaction;
  }

  assert.equal(upgradeCalled, false);
});

test('enrollMapleradCustomerTier1 captures provider validation failure without confirming Tier 1', async () => {
  const service = serviceWithMockedRequest(async () => null, false);
  const originalTransaction = AppDataSource.transaction.bind(AppDataSource);
  const user = { id: 'user-1', phoneNumber: '+2348012345678' };
  const manager: any = {
    getRepository: (entity: any) => {
      if (entity?.name === 'Profile') {
        return { findOne: async () => ({ id: 'profile-1', dateOfBirth: '1990-01-31', address: '12 Example Road', city: 'Ikeja', state: 'Lagos', postalCode: '100001', country: 'NG' }) };
      }
      if (entity?.name === 'ProviderReference') return { findOne: async () => undefined, create: (value: any) => value, save: async (value: any) => value };
      if (entity?.name === 'AuditLog') return { create: (value: any) => value, save: async (value: any) => value };
      return {
        createQueryBuilder: () => ({
          where: () => ({ setLock: () => ({ getOne: async () => user }) }),
        }),
      };
    },
  };
  (AppDataSource as any).transaction = async (callback: any) => callback(manager);
  (service as any).ensureMapleRadCustomerForUser = async () => 'cus_1';
  (service as any).getCustomerById = async (customerId: string) => ({ id: customerId, tier: '0' });
  (service as any).upgradeCustomerTier1 = async () => {
    throw new MapleradProviderError(
      'maplerad.customer.upgrade_tier1 failed with Maplerad status 400',
      'maplerad.customer.upgrade_tier1',
      400,
      'invalid tier 1 payload',
      'req-tier1',
      { message: 'invalid tier 1 payload' },
      'VALIDATION'
    );
  };

  try {
    const result = await service.enrollMapleradCustomerTier1('user-1', undefined, { bvn: '12345678901' });
    assert.equal(result.state, 'FAILED');
    assert.equal(result.tier1, false);
    assert.equal(result.providerStatus, 400);
    assert.equal(result.requestId, 'req-tier1');
  } finally {
    (AppDataSource as any).transaction = originalTransaction;
  }
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
      if (entity?.name === 'AuditLog') {
        return {
          create: (value: any) => value,
          save: async (value: any) => value,
        };
      }
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
  (service as any).requestMapleradRaw = async (options: any) => {
    observed = options;
    return {
      status: 200,
      headers: { 'x-request-id': 'req-wallet-create' },
      data: { id: 'acct_1', account_number: '1234567890', bank_name: 'Test Bank', currency: 'NGN' },
    };
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

test('createVirtualAccountForUser continues with newly extracted customer id and persists it', async () => {
  let virtualAccountRequest: any;
  const service = serviceWithMockedRequest(async (options) => {
    if (options.operation === 'maplerad.virtual_account.create') {
      virtualAccountRequest = options;
      return {
        status: 200,
        headers: { 'x-request-id': 'req-wallet-create' },
        data: { id: 'acct_wallet', account_number: '1234567890', bank_name: 'Test Bank', currency: 'NGN' },
      };
    }
    return {
    status: 200,
    headers: { 'x-request-id': 'req-customer-wallet' },
    data: {
      status: true,
      message: 'Customer created',
      data: { customer: { id: 'cus_wallet', email: 'ada@example.com', first_name: 'Ada', last_name: 'Okafor' } },
    },
    };
  }, true);
  (service as any).activeRecoveryCooldown = async () => undefined;
  const originalTransaction = AppDataSource.transaction.bind(AppDataSource);
  const user = { id: 'user-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Okafor' };
  const references: any[] = [];
  let savedWallet: any;
  const walletRepo: any = {
    findOne: async () => null,
    create: (value: any) => value,
    save: async (value: any) => {
      savedWallet = value;
      return value;
    },
  };
  const referenceRepo: any = {
    findOne: async ({ where }: any) => references.find((ref) =>
      ref.referenceType === where.referenceType && (!where.currency || ref.currency === where.currency)
    ),
    create: (value: any) => value,
    save: async (value: any) => {
      references.push(value);
      return value;
    },
  };
  const manager: any = {
    getRepository: (entity: any) => {
      if (entity?.name === 'Wallet') return walletRepo;
      if (entity?.name === 'ProviderReference') return referenceRepo;
      if (entity?.name === 'AuditLog') {
        return {
          create: (value: any) => value,
          save: async (value: any) => value,
        };
      }
      return {
        createQueryBuilder: () => ({
          where: () => ({ setLock: () => ({ getOne: async () => user }) }),
        }),
      };
    },
  };
  (AppDataSource as any).transaction = async (callback: any) => callback(manager);
  (service as any).getCustomerById = async (customerId: string) => {
    assert.equal(customerId, 'cus_wallet');
    return { id: customerId, tier: '1', email: user.email, first_name: user.firstName, last_name: user.lastName };
  };
  (service as any).getCustomerVirtualAccounts = async (customerId: string) => {
    assert.equal(customerId, 'cus_wallet');
    return [];
  };
  try {
    await service.createVirtualAccountForUser('user-1', 'NGN');
  } finally {
    (AppDataSource as any).transaction = originalTransaction;
  }

  assert.deepEqual(virtualAccountRequest.payload, { customer_id: 'cus_wallet', currency: 'NGN' });
  const customerReference = references.find((ref) => ref.referenceType === 'customer');
  const accountReference = references.find((ref) => ref.referenceType === 'account' && ref.currency === 'NGN');
  assert.equal(customerReference.providerCustomerId, 'cus_wallet');
  assert.equal(customerReference.externalReference, 'cus_wallet');
  assert.equal(accountReference.providerCustomerId, 'cus_wallet');
  assert.equal(accountReference.providerAccountId, 'acct_wallet');
  assert.equal(savedWallet.mapleradAccountId, 'acct_wallet');
  assert.equal(savedWallet.accountNumber, '1234567890');
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

test('customer already enrolled maps to reconciliation required client response', () => {
  const error = new MapleradProviderError(
    'maplerad.customer.create failed: customer is already enrolled',
    'maplerad.customer.create',
    400,
    'customer is already enrolled',
    'req-enrolled',
    { message: 'customer is already enrolled' },
    'VALIDATION'
  );

  assert.equal(mapleradErrorToApplicationCode(error), 'MAPLERAD_CUSTOMER_RECONCILIATION_REQUIRED');
  assert.equal(mapleradErrorToHttpStatus(error), 400);
});

test('createUsdVirtualAccount reuses existing customer reference and persists USD wallet', async () => {
  const service = serviceWithMockedRequest(async () => null, false);
  const originalTransaction = AppDataSource.transaction.bind(AppDataSource);
  const operations: string[] = [];
  const user = { id: 'user-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Okafor' };
  const references: any[] = [{
    userId: user.id,
    provider: 'maplerad',
    providerEnvironment: 'sandbox',
    referenceType: 'customer',
    providerCustomerId: 'cus_shared',
  }];
  let savedWallet: any;

  const manager: any = {
    getRepository: (entity: any) => {
      if (entity?.name === 'Wallet') {
        return {
          findOne: async () => null,
          create: (value: any) => value,
          save: async (value: any) => {
            savedWallet = value;
            return value;
          },
        };
      }
      if (entity?.name === 'ProviderReference') {
        return {
          findOne: async ({ where }: any) => references.find((ref) =>
            ref.referenceType === where.referenceType && (!where.currency || ref.currency === where.currency)
          ),
          create: (value: any) => value,
          save: async (value: any) => {
            references.push(value);
            return value;
          },
        };
      }
      return {
        createQueryBuilder: () => ({
          where: () => ({ setLock: () => ({ getOne: async () => user }) }),
        }),
      };
    },
  };

  (AppDataSource as any).transaction = async (callback: any) => callback(manager);
  (service as any).getCustomerById = async (customerId: string) => ({
    id: customerId,
    email: user.email,
    first_name: user.firstName,
    last_name: user.lastName,
  });
  (service as any).getCustomerVirtualAccounts = async () => [];
  (service as any).requestMaplerad = async (options: any) => {
    operations.push(options.operation);
    return { id: 'usd_acct_1', account_number: '1234567890', bank_name: 'USD Bank', currency: 'USD', status: 'pending' };
  };

  try {
    const wallet = await service.createUsdVirtualAccount(user.id);
    assert.equal(wallet.currency, 'USD');
  } finally {
    (AppDataSource as any).transaction = originalTransaction;
  }

  assert.deepEqual(operations, ['maplerad.virtual_account.create_usd']);
  assert.equal(savedWallet.mapleradAccountId, 'usd_acct_1');
  assert.equal(savedWallet.usdAccountId, 'usd_acct_1');
  const usdReference = references.find((ref) => ref.referenceType === 'account' && ref.currency === 'USD');
  assert.equal(usdReference.providerCustomerId, 'cus_shared');
  assert.equal(usdReference.providerAccountId, 'usd_acct_1');
});

test('createVirtualAccountForUser repairs missing NGN wallet from existing provider account', async () => {
  const service = serviceWithMockedRequest(async () => null, false);
  const originalTransaction = AppDataSource.transaction.bind(AppDataSource);
  const user = { id: 'user-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Okafor' };
  const references: any[] = [{
    userId: user.id,
    provider: 'maplerad',
    providerEnvironment: 'sandbox',
    referenceType: 'customer',
    providerCustomerId: 'cus_shared',
  }];
  let savedWallet: any;
  const providerCreates: any[] = [];

  const manager: any = {
    getRepository: (entity: any) => {
      if (entity?.name === 'Wallet') {
        return {
          findOne: async () => null,
          create: (value: any) => value,
          save: async (value: any) => {
            savedWallet = value;
            return value;
          },
        };
      }
      if (entity?.name === 'ProviderReference') {
        return {
          findOne: async ({ where }: any) => references.find((ref) =>
            ref.referenceType === where.referenceType && (!where.currency || ref.currency === where.currency)
          ),
          create: (value: any) => value,
          save: async (value: any) => {
            references.push(value);
            return value;
          },
        };
      }
      return {
        createQueryBuilder: () => ({
          where: () => ({ setLock: () => ({ getOne: async () => user }) }),
        }),
      };
    },
  };

  (AppDataSource as any).transaction = async (callback: any) => callback(manager);
  (service as any).getCustomerById = async (customerId: string) => ({
    id: customerId,
    tier: '1',
    email: user.email,
    first_name: user.firstName,
    last_name: user.lastName,
  });
  (service as any).getCustomerVirtualAccounts = async () => [
    { id: 'ngn_acct_1', account_number: '1234567890', bank_name: 'NGN Bank', currency: 'NGN' },
  ];
  (service as any).requestMaplerad = async (options: any) => {
    providerCreates.push(options);
    throw new Error('provider account create should not be called');
  };

  try {
    await service.createVirtualAccountForUser(user.id, 'NGN');
  } finally {
    (AppDataSource as any).transaction = originalTransaction;
  }

  assert.equal(providerCreates.length, 0);
  assert.equal(savedWallet.mapleradAccountId, 'ngn_acct_1');
  const ngnReference = references.find((ref) => ref.referenceType === 'account' && ref.currency === 'NGN');
  assert.equal(ngnReference.providerCustomerId, 'cus_shared');
  assert.equal(ngnReference.providerAccountId, 'ngn_acct_1');
});

test('bounded customer recovery pagination stops when a page is shorter than page size', async () => {
  process.env.MAPLERAD_CUSTOMER_RECOVERY_PAGE_SIZE = '2';
  process.env.MAPLERAD_CUSTOMER_RECOVERY_MAX_PAGES = '20';
  const pages: number[] = [];
  const service = serviceWithMockedRequest(async (options) => {
    pages.push(options.params.page);
    return {
      status: 200,
      headers: { 'x-request-id': `req-page-${options.params.page}` },
      data: {
        data: options.params.page === 1
          ? [
              { id: 'cus_1', email: 'one@example.com' },
              { id: 'cus_2', email: 'two@example.com' },
            ]
          : [{ id: 'cus_3', email: 'three@example.com' }],
      },
    };
  }, true);

  const result = await service.listCustomersForRecovery();

  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.customers.length, 3);
  assert.deepEqual(result.requestIds, ['req-page-1', 'req-page-2']);
});

test('customer recovery list parser supports documented wrappers and rejects malformed responses', () => {
  const service = serviceWithMockedRequest(async () => null);
  assert.deepEqual((service as any).customerListFromEnvelope({ data: { customers: [{ id: 'cus_data_customers' }] } })[0].id, 'cus_data_customers');
  assert.deepEqual((service as any).customerListFromEnvelope({ customers: [{ id: 'cus_customers' }] })[0].id, 'cus_customers');
  assert.deepEqual((service as any).customerListFromEnvelope({ result: [{ id: 'cus_result' }] })[0].id, 'cus_result');
  assert.deepEqual((service as any).customerListFromEnvelope({ result: { customers: [{ id: 'cus_result_customers' }] } })[0].id, 'cus_result_customers');
  assert.throws(
    () => (service as any).customerListFromEnvelope({ data: { total: 1 } }),
    (error: any) => {
      assert.equal(isMapleradProviderError(error), true);
      assert.equal(error.code, 'SCHEMA');
      return true;
    }
  );
});

test('customer recovery identity matching requires verified email phone and names', async () => {
  const service = serviceWithMockedRequest(async () => null, false);
  const user: any = {
    id: 'user-1',
    email: ' ADA@Example.com ',
    phoneNumber: '08012345678',
    firstName: 'Ada',
    lastName: 'Oka-for',
    isVerified: true,
    isKYCVerified: true,
  };
  const manager: any = {
    getRepository: () => ({
      findOne: async () => null,
    }),
  };

  const exact = await service.evaluateCustomerIdentityMatch(user, {
    id: 'cus_1',
    email: 'ada@example.com',
    phone: '+2348012345678',
    first_name: 'Ada',
    last_name: 'Okafor',
  } as any, manager);
  const partial = await service.evaluateCustomerIdentityMatch(user, {
    id: 'cus_2',
    email: 'ada@example.com',
    phone: '+2348012345678',
    first_name: 'Ada',
    last_name: 'Other',
  } as any, manager);

  assert.equal(exact.exact, true);
  assert.deepEqual(exact.matchedFields.sort(), ['email', 'first_name', 'last_name', 'phone'].sort());
  assert.equal(partial.exact, false);
  assert.deepEqual(partial.mismatches, ['last_name']);
});

test('customer recovery allows missing optional DOB but rejects conflicting DOB', async () => {
  const service = serviceWithMockedRequest(async () => null, false);
  const user: any = {
    id: 'user-1',
    email: 'ada@example.com',
    phoneNumber: '+2348012345678',
    firstName: 'Ada',
    lastName: 'Okafor',
    isVerified: true,
    isKYCVerified: true,
  };
  const managerWithDob: any = {
    getRepository: () => ({
      findOne: async () => ({ dateOfBirth: '1990-01-31' }),
    }),
  };

  const missingDob = await service.evaluateCustomerIdentityMatch(user, {
    id: 'cus_1',
    email: 'ada@example.com',
    phone: '+2348012345678',
    first_name: 'Ada',
    last_name: 'Okafor',
  } as any, managerWithDob);
  const conflictingDob = await service.evaluateCustomerIdentityMatch(user, {
    id: 'cus_2',
    email: 'ada@example.com',
    phone: '+2348012345678',
    first_name: 'Ada',
    last_name: 'Okafor',
    dob: '1991-01-31',
  } as any, managerWithDob);

  assert.equal(missingDob.exact, true);
  assert.equal(conflictingDob.exact, false);
  assert.deepEqual(conflictingDob.mismatches, ['dob']);
});

test('missing verified profile returns profile-incomplete during exact recovery', async () => {
  const service = serviceWithMockedRequest(async () => null, true);
  const user: any = {
    id: 'user-1',
    email: 'ada@example.com',
    phoneNumber: '',
    firstName: 'Ada',
    lastName: 'Okafor',
    isVerified: true,
    isKYCVerified: true,
  };
  const manager: any = {
    getRepository: () => ({ findOne: async () => null }),
  };
  (service as any).recordRecoveryAttempt = async () => undefined;

  await assert.rejects(
    () => (service as any).recoverAlreadyEnrolledCustomer(
      user,
      manager,
      new MapleradProviderError('already enrolled', 'maplerad.customer.create', 400, 'customer is already enrolled', 'req', {}, 'VALIDATION')
    ),
    (error: any) => {
      assert.equal(error instanceof MapleradCustomerRecoveryError, true);
      assert.equal(error.applicationCode, 'MAPLERAD_CUSTOMER_RECOVERY_PROFILE_INCOMPLETE');
      return true;
    }
  );
});

test('recovery cooldown is reused only for unchanged identity fingerprint and parser version', async () => {
  const service = serviceWithMockedRequest(async () => null);
  const originalGetRepository = AppDataSource.getRepository.bind(AppDataSource);
  const future = new Date(Date.now() + 60000);
  try {
    (AppDataSource as any).getRepository = () => ({
      findOne: async () => ({
        result: 'not_found',
        expiresAt: future,
        identityFingerprint: 'same-fingerprint',
        metadata: { parserVersion: (service as any).recoveryParserVersion() },
      }),
    });
    assert.ok(await (service as any).activeRecoveryCooldown('user-1', 'already_enrolled', 'same-fingerprint'));
    assert.equal(await (service as any).activeRecoveryCooldown('user-1', 'already_enrolled', 'new-fingerprint'), undefined);
  } finally {
    (AppDataSource as any).getRepository = originalGetRepository;
  }
});

test('already enrolled recovery persists exactly one matched customer and continues', async () => {
  const service = serviceWithMockedRequest(async (options) => {
    if (options.operation === 'maplerad.customer.create') {
      throw new MapleradProviderError(
        'maplerad.customer.create failed: customer is already enrolled',
        'maplerad.customer.create',
        400,
        'customer is already enrolled',
        'req-enrolled',
        { message: 'customer is already enrolled' },
        'VALIDATION'
      );
    }
    throw new Error('unexpected request');
  }, true);
  const user: any = {
    id: 'user-1',
    email: 'ada@example.com',
    phoneNumber: '+2348012345678',
    firstName: 'Ada',
    lastName: 'Okafor',
    isVerified: true,
    isKYCVerified: true,
  };
  const references: any[] = [];
  const audits: any[] = [];
  const manager: any = {
    getRepository: (entity: any) => {
      if (entity?.name === 'ProviderReference') {
        return {
          findOne: async ({ where }: any) => references.find((ref) =>
            ref.referenceType === where.referenceType &&
            (!where.providerCustomerId || ref.providerCustomerId === where.providerCustomerId)
          ),
          create: (value: any) => ({ id: 'ref-1', ...value }),
          save: async (value: any) => {
            references.push(value);
            return value;
          },
        };
      }
      if (entity?.name === 'AuditLog') {
        return {
          create: (value: any) => value,
          save: async (value: any) => {
            audits.push(value);
            return value;
          },
        };
      }
      if (entity?.name === 'Profile') {
        return { findOne: async () => null };
      }
      return {
        createQueryBuilder: () => ({
          where: () => ({ setLock: () => ({ getOne: async () => user }) }),
        }),
      };
    },
  };
  (service as any).activeRecoveryCooldown = async () => undefined;
  (service as any).recordRecoveryAttempt = async () => undefined;
  (service as any).listCustomersForRecovery = async () => ({
    customers: [{
      id: 'cus_recovered',
      email: 'ada@example.com',
      phone: '+2348012345678',
      first_name: 'Ada',
      last_name: 'Okafor',
    }],
    requestIds: ['req-list'],
    limits: {},
  });

  const customerId = await (service as any).ensureMapleRadCustomerForUser(user.id, manager);

  assert.equal(customerId, 'cus_recovered');
  assert.equal(references.length, 1);
  assert.equal(references[0].referenceType, 'customer');
  assert.equal(references[0].providerCustomerId, 'cus_recovered');
  assert.equal(references[0].status, 'auto_recovered');
  assert.equal(audits[0].action, 'MAPLERAD_CUSTOMER_AUTO_RECONCILED');
});

test('already enrolled recovery refuses multiple exact matches', async () => {
  const service = serviceWithMockedRequest(async () => null, true);
  const user: any = {
    id: 'user-1',
    email: 'ada@example.com',
    phoneNumber: '+2348012345678',
    firstName: 'Ada',
    lastName: 'Okafor',
    isVerified: true,
    isKYCVerified: true,
  };
  const manager: any = {
    getRepository: (entity: any) => {
      if (entity?.name === 'Profile') return { findOne: async () => null };
      return { findOne: async () => null };
    },
  };
  (service as any).activeRecoveryCooldown = async () => undefined;
  (service as any).recordRecoveryAttempt = async () => undefined;
  (service as any).listCustomersForRecovery = async () => ({
    customers: [
      { id: 'cus_1', email: 'ada@example.com', phone: '+2348012345678', first_name: 'Ada', last_name: 'Okafor' },
      { id: 'cus_2', email: 'ada@example.com', phone: '+2348012345678', first_name: 'Ada', last_name: 'Okafor' },
    ],
    requestIds: [],
    limits: {},
  });

  await assert.rejects(
    () => (service as any).recoverAlreadyEnrolledCustomer(
      user,
      manager,
      new MapleradProviderError('already enrolled', 'maplerad.customer.create', 400, 'customer is already enrolled', 'req', {}, 'VALIDATION')
    ),
    (error: any) => {
      assert.equal(error instanceof MapleradCustomerRecoveryError, true);
      assert.equal(error.applicationCode, 'MAPLERAD_CUSTOMER_AMBIGUOUS');
      return true;
    }
  );
});
