import 'dotenv/config';
import crypto from 'crypto';

type HttpMethod = 'GET' | 'POST' | 'PUT';

type StepStatus = 'PASS' | 'FAIL' | 'SKIP' | 'MANUAL';

type StepResult = {
  step: string;
  status: StepStatus;
  detail?: string;
};

type SmokeResponse<T = any> = {
  status: number;
  ok: boolean;
  data: T;
};

const baseUrl = requiredEnv('STAGING_BASE_URL').replace(/\/+$/, '');
const testPassword = process.env.SMOKE_TEST_PASSWORD || `Smoke-${crypto.randomUUID()}-Pass!`;
const testPin = process.env.SMOKE_TEST_PIN || String(crypto.randomInt(1000, 10000));
const testOtp = process.env.TEST_OTP || process.env.DEV_TEST_OTP || process.env.SMOKE_TEST_OTP;
const tokenOverride = process.env.TEST_USER_TOKEN;
const explicitUserId = process.env.TEST_USER_ID;
const sandboxBvn = process.env.MAPLERAD_SANDBOX_BVN || process.env.SMOKE_TEST_BVN;
const webhookSecret = process.env.MAPLERAD_WEBHOOK_SECRET || process.env.SMOKE_MAPLERAD_WEBHOOK_SECRET;
const webhookHeader = process.env.MAPLERAD_SIGNATURE_HEADER || 'x-maplerad-signature';

const startedAt = Date.now();
const runId = Date.now().toString(36);
const emailDomain = process.env.SMOKE_TEST_EMAIL_DOMAIN || 'example.com';
const testEmail = process.env.SMOKE_TEST_EMAIL || `papafi.smoke.${runId}@${emailDomain}`;
const testPhone = process.env.SMOKE_TEST_PHONE || `+1555${String(Date.now()).slice(-10)}`;
const results: StepResult[] = [];

let authToken = tokenOverride || '';
let userId = explicitUserId || (tokenOverride ? decodeJwtUserId(tokenOverride) : '');
let walletId = '';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
  return value;
}

function decodeJwtUserId(token: string): string {
  try {
    const payload = token.split('.')[1];
    if (!payload) return '';
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json).id || '';
  } catch {
    return '';
  }
}

function redact(value: any): any {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const normalized = key.toLowerCase();
      if (
        normalized.includes('token') ||
        normalized.includes('password') ||
        normalized.includes('pin') ||
        normalized.includes('otp') ||
        normalized.includes('bvn') ||
        normalized.includes('secret') ||
        normalized.includes('authorization') ||
        normalized.includes('signature') ||
        normalized.includes('accountnumber') ||
        normalized.includes('account_number') ||
        normalized.includes('cardnumber') ||
        normalized.includes('card_number') ||
        normalized === 'cvv'
      ) {
        return [key, '[redacted]'];
      }
      return [key, redact(entry)];
    })
  );
}

function safeString(value: any): string {
  if (typeof value === 'string') return value.slice(0, 500);
  return JSON.stringify(redact(value), null, 2).slice(0, 1200);
}

async function request<T = any>(
  method: HttpMethod,
  path: string,
  options: {
    body?: any;
    token?: string;
    headers?: Record<string, string>;
    expected?: number[];
  } = {}
): Promise<SmokeResponse<T>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };

  let body: string | undefined;
  if (options.body !== undefined) {
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }

  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body,
  });

  const text = await response.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  const expected = options.expected || [200];
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path} returned ${response.status}. Response: ${safeString(data)}`);
  }

  return { status: response.status, ok: response.ok, data };
}

async function step(name: string, fn: () => Promise<string | void>) {
  process.stdout.write(`- ${name} ... `);
  try {
    const detail = (await fn()) || undefined;
    results.push({ step: name, status: 'PASS', detail });
    console.log(`PASS${detail ? ` (${detail})` : ''}`);
  } catch (error: any) {
    results.push({ step: name, status: 'FAIL', detail: error?.message || String(error) });
    console.log('FAIL');
    console.error(`  ${error?.message || error}`);
    printSummary();
    process.exit(1);
  }
}

function skip(name: string, detail: string) {
  results.push({ step: name, status: 'SKIP', detail });
  console.log(`- ${name} ... SKIP (${detail})`);
}

function manual(name: string, detail: string) {
  results.push({ step: name, status: 'MANUAL', detail });
  console.log(`- ${name} ... MANUAL (${detail})`);
}

async function main() {
  console.log(`Papafi staging smoke test`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Test email: ${testEmail}`);

  await step('GET /health', async () => {
    const res = await request('GET', '/health');
    if (res.data?.status !== 'ok') throw new Error(`Unexpected health response: ${safeString(res.data)}`);
  });

  await step('GET /ready', async () => {
    const res = await request('GET', '/ready');
    if (res.data?.status !== 'ready') throw new Error(`Unexpected readiness response: ${safeString(res.data)}`);
  });

  if (!authToken) {
    await step('POST /api/auth/register', async () => {
      await request('POST', '/api/auth/register', {
        body: {
          firstName: 'Papafi',
          lastName: 'Smoke',
          email: testEmail,
          password: testPassword,
          gender: 'test',
          phoneNumber: testPhone,
        },
        expected: [200],
      });
    });

    if (!testOtp) {
      manual(
        'POST /api/auth/verify-otp',
        'No TEST_OTP/DEV_TEST_OTP/SMOKE_TEST_OTP provided. Retrieve the OTP out-of-band, then rerun with TEST_OTP or provide TEST_USER_TOKEN.'
      );
      printSummary();
      process.exit(0);
    }

    await step('POST /api/auth/verify-otp', async () => {
      const res = await request<{ token: string }>('POST', '/api/auth/verify-otp', {
        body: { email: testEmail, otp: testOtp },
        expected: [200],
      });
      authToken = res.data.token;
      userId = decodeJwtUserId(authToken);
      if (!authToken || !userId) throw new Error('OTP verification did not return a usable token.');
    });

    await step('POST /api/auth/login', async () => {
      const res = await request<{ token: string; userId: string }>('POST', '/api/auth/login', {
        body: { email: testEmail, password: testPassword },
        expected: [200],
      });
      authToken = res.data.token;
      userId = res.data.userId || decodeJwtUserId(authToken);
      if (!authToken || !userId) throw new Error('Login did not return token and userId.');
      return `userId=${userId}`;
    });
  } else {
    if (!userId) {
      manual('TEST_USER_TOKEN decode', 'Token provided but user id could not be decoded. Set TEST_USER_ID to continue authenticated route checks.');
      printSummary();
      process.exit(0);
    }
    skip('POST /api/auth/register', 'TEST_USER_TOKEN provided');
    skip('POST /api/auth/verify-otp', 'TEST_USER_TOKEN provided');
    skip('POST /api/auth/login', 'TEST_USER_TOKEN provided');
  }

  await step('POST /api/auth/create-pin', async () => {
    await request('POST', '/api/auth/create-pin', {
      token: authToken,
      body: { pin: testPin },
      expected: [200],
    });
  });

  if (sandboxBvn) {
    await step('POST /api/kyc/bvn', async () => {
      const res = await request('POST', '/api/kyc/bvn', {
        token: authToken,
        body: { bvn: sandboxBvn },
        expected: [200, 502],
      });
      if (res.status === 502) throw new Error(`Maplerad sandbox BVN verification failed: ${safeString(res.data)}`);
      return `status=${res.data?.status || 'unknown'}`;
    });
  } else {
    skip('POST /api/kyc/bvn', 'MAPLERAD_SANDBOX_BVN/SMOKE_TEST_BVN not provided');
  }

  await step('POST /api/kyc/documents', async () => {
    await request('POST', '/api/kyc/documents', {
      token: authToken,
      body: {
        documentType: 'NIN',
        documentNumber: `SMOKE-${runId}`,
        frontImageUrl: 'https://example.com/papafi-smoke/front.jpg',
        selfieImageUrl: 'https://example.com/papafi-smoke/selfie.jpg',
        issuedCountry: 'NG',
        expiresAt: '2035-12-31',
      },
      expected: [201],
    });
  });

  await step('POST /api/wallet/create/{userId}', async () => {
    const res = await request<any>('POST', `/api/wallet/create/${userId}`, {
      token: authToken,
      expected: [200, 201],
    });
    walletId = res.data?.wallet?.id;
    if (!walletId) throw new Error(`Wallet response did not include wallet.id: ${safeString(res.data)}`);
    return `walletId=${walletId}`;
  });

  await step('POST /api/wallet/create-usd/{userId}', async () => {
    await request('POST', `/api/wallet/create-usd/${userId}`, {
      token: authToken,
      expected: [200, 201, 400],
    });
  });

  await step('GET /api/wallet/balance/{userId}', async () => {
    const res = await request<any>('GET', `/api/wallet/balance/${userId}`, {
      token: authToken,
      expected: [200],
    });
    if (!Array.isArray(res.data?.wallets)) throw new Error(`Expected wallets array: ${safeString(res.data)}`);
  });

  await step('GET /api/transaction', async () => {
    const res = await request('GET', '/api/transaction', {
      token: authToken,
      expected: [200],
    });
    if (typeof res.data?.count !== 'number') throw new Error(`Expected transaction count: ${safeString(res.data)}`);
  });

  await step('Idempotency requirement on withdrawal without money movement', async () => {
    const res = await request('POST', '/api/wallet/withdraw', {
      token: authToken,
      body: {
        amount: 1,
        currency: 'NGN',
        bankCode: 'sandbox_bank',
        accountNumber: 'sandbox_account',
        accountName: 'Papafi Smoke',
        description: 'Smoke test idempotency check',
        transactionPin: testPin,
      },
      expected: [400],
    });
    const message = String(res.data?.message || '');
    if (!message.toLowerCase().includes('idempotency-key')) {
      throw new Error(`Expected missing Idempotency-Key error, got: ${safeString(res.data)}`);
    }
  });

  if (webhookSecret) {
    const payload = JSON.stringify({
      id: `smoke_evt_${runId}`,
      event: 'smoke.test',
      data: {
        reference: `smoke_ref_${runId}`,
        status: 'sandbox',
      },
    });
    const signature = crypto.createHmac('sha512', webhookSecret).update(payload).digest('hex');

    await step('POST /api/wallet/webhook signed mock event', async () => {
      const res = await request('POST', '/api/wallet/webhook', {
        body: payload,
        headers: { [webhookHeader]: signature },
        expected: [200],
      });
      if (res.data?.ok !== true) throw new Error(`Unexpected webhook response: ${safeString(res.data)}`);
    });

    await step('POST /api/wallet/webhook duplicate signed mock event', async () => {
      const res = await request('POST', '/api/wallet/webhook', {
        body: payload,
        headers: { [webhookHeader]: signature },
        expected: [200],
      });
      if (res.data?.ok !== true || res.data?.duplicate !== true) {
        throw new Error(`Expected duplicate webhook response: ${safeString(res.data)}`);
      }
    });
  } else {
    skip('POST /api/wallet/webhook signed mock event', 'MAPLERAD_WEBHOOK_SECRET/SMOKE_MAPLERAD_WEBHOOK_SECRET not provided');
    skip('POST /api/wallet/webhook duplicate signed mock event', 'MAPLERAD_WEBHOOK_SECRET/SMOKE_MAPLERAD_WEBHOOK_SECRET not provided');
  }

  await step('Admin endpoints reject normal user token', async () => {
    const checks: Array<[HttpMethod, string]> = [
      ['GET', '/api/admin/audit-logs'],
      ['GET', '/api/admin/risk-flags'],
      ['GET', '/api/admin/reconciliation'],
      ['POST', `/api/admin/transactions/${crypto.randomUUID()}/manual-review`],
      ['GET', `/api/admin/users/${userId}/wallet-summary`],
    ];

    for (const [method, path] of checks) {
      await request(method, path, {
        token: authToken,
        body: method === 'POST' ? { notes: 'smoke test unauthorized check' } : undefined,
        expected: [401, 403],
      });
    }
  });

  printSummary();
}

function printSummary() {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\nSummary');
  for (const result of results) {
    console.log(`${result.status.padEnd(6)} ${result.step}${result.detail ? ` - ${result.detail}` : ''}`);
  }
  console.log(`Elapsed: ${elapsed}s`);
}

main().catch((error) => {
  results.push({ step: 'Unhandled error', status: 'FAIL', detail: error?.message || String(error) });
  console.error(error?.message || error);
  printSummary();
  process.exit(1);
});
