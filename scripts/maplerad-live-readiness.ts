import 'dotenv/config';
import crypto from 'crypto';
import axios, { AxiosError } from 'axios';

type StepStatus = 'PASS' | 'FAIL' | 'SKIP';

type StepResult = {
  step: string;
  status: StepStatus;
  detail?: string;
};

const results: StepResult[] = [];
const secretKey = process.env.MAPLERAD_SECRET_KEY || process.env.MAPLERAD_SECRET;
const environment = process.env.MAPLERAD_ENVIRONMENT || process.env.MAPLERAD_ENV || process.env.NODE_ENV || 'unspecified';
const liveTestsEnabled = process.env.MAPLERAD_LIVE_TESTS_ENABLED === 'true';
const testEmail = process.env.MAPLERAD_LIVE_TEST_CUSTOMER_EMAIL;
const testPhone = process.env.MAPLERAD_LIVE_TEST_PHONE;
const testBvn = process.env.MAPLERAD_LIVE_TEST_BVN;
const baseUrl = normalizeBaseUrl(process.env.MAPLERAD_BASE_URL || 'https://api.maplerad.com/v1');

const http = axios.create({
  baseURL: baseUrl,
  timeout: 15000,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  validateStatus: () => true,
});

function normalizeBaseUrl(url: string) {
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function sanitize(value: any): any {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const normalized = key.toLowerCase();
      if (
        normalized.includes('authorization') ||
        normalized.includes('token') ||
        normalized.includes('secret') ||
        normalized.includes('bvn') ||
        normalized.includes('phone') ||
        normalized.includes('email') ||
        normalized.includes('account_number') ||
        normalized.includes('accountnumber') ||
        normalized.includes('card_number') ||
        normalized.includes('cardnumber') ||
        normalized.includes('pan') ||
        normalized === 'cvv'
      ) {
        return [key, '[redacted]'];
      }
      return [key, sanitize(entry)];
    })
  );
}

function responseRequestId(headers: any) {
  return headers?.['x-request-id'] || headers?.['x-amzn-requestid'] || headers?.['request-id'] || 'not_returned';
}

function explainStatus(status: number) {
  if (status === 401) return 'invalid/revoked/wrong-environment secret key or bad auth header';
  if (status === 403) return 'likely IP whitelist, account permission, or compliance restriction';
  if (status === 404) return 'obsolete endpoint or wrong base-path construction';
  if (status === 400 || status === 422) return 'provider validation error; compare sanitized details with current docs';
  if (status >= 500) return 'provider/server error';
  return 'unexpected status';
}

function printEndpoint(method: string, endpoint: string, status: number | string, requestId?: string, error?: any) {
  const line = `${method} ${endpoint} status=${status} requestId=${requestId || 'not_returned'}`;
  if (error) {
    console.log(`${line} error=${JSON.stringify(sanitize(error)).slice(0, 500)}`);
  } else {
    console.log(line);
  }
}

async function step(name: string, fn: () => Promise<string | void>) {
  process.stdout.write(`- ${name} ... `);
  try {
    const detail = await fn();
    results.push({ step: name, status: 'PASS', detail: detail || undefined });
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

async function providerRequest(method: 'GET' | 'POST', endpoint: string, body?: any) {
  if (!secretKey) throw new Error('Missing MAPLERAD_SECRET_KEY or MAPLERAD_SECRET');
  const requestId = crypto.randomUUID();
  try {
    const response = await http.request({
      method,
      url: endpoint,
      data: body,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'X-Request-Id': requestId,
      },
    });

    const providerRequestId = responseRequestId(response.headers);
    printEndpoint(method, endpoint, response.status, providerRequestId);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${method} ${endpoint} returned ${response.status}: ${explainStatus(response.status)} ${JSON.stringify(sanitize(response.data)).slice(0, 500)}`);
    }
    return response;
  } catch (error: any) {
    if ((error as AxiosError).code === 'ECONNABORTED') {
      printEndpoint(method, endpoint, 'TIMEOUT', requestId);
      throw new Error(`${method} ${endpoint} timed out after 15 seconds`);
    }
    if (error?.response) throw error;
    if (String(error?.message || '').includes(`${method} ${endpoint} returned`)) throw error;
    printEndpoint(method, endpoint, 'NETWORK_ERROR', requestId, { message: error?.message });
    throw error;
  }
}

async function main() {
  console.log('Maplerad live readiness check');
  console.log(`Environment: ${environment}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Secret key configured: ${secretKey ? 'yes' : 'no'}`);
  console.log(`Live customer creation enabled: ${liveTestsEnabled ? 'yes' : 'no'}`);

  await step('Configuration', async () => {
    if (!secretKey) throw new Error('Missing MAPLERAD_SECRET_KEY or MAPLERAD_SECRET');
    if (!baseUrl.startsWith('https://')) throw new Error('Maplerad base URL must use HTTPS');
    return 'secret present, HTTPS base URL configured';
  });

  await step('Authentication and IP authorization', async () => {
    const response = await providerRequest('GET', '/customers?page=1&page_size=1');
    const body: any = response.data;
    if (!body || typeof body !== 'object') throw new Error('Schema mismatch: expected JSON object response');
    return 'GET /customers succeeded';
  });

  if (liveTestsEnabled) {
    if (!testEmail) {
      skip('Tier 0 test customer creation', 'MAPLERAD_LIVE_TEST_CUSTOMER_EMAIL is required when MAPLERAD_LIVE_TESTS_ENABLED=true');
    } else {
      await step('Tier 0 test customer creation', async () => {
        const localPart = testEmail.split('@')[0] || 'papafi';
        const response = await providerRequest('POST', '/customers', {
          first_name: 'Papafi',
          last_name: `Readiness ${localPart.slice(-8)}`,
          email: testEmail,
          country: 'NG',
        });
        const data: any = response.data?.data || response.data;
        if (!data?.id) throw new Error('Schema mismatch: customer response did not include an id');
        return 'created/readiness customer id returned';
      });
    }
  } else {
    skip('Tier 0 test customer creation', 'MAPLERAD_LIVE_TESTS_ENABLED is not true');
  }

  if (testBvn || testPhone) {
    skip('BVN/identity live check', 'Identity tests are intentionally refused by this script; run only through controlled Papafi smoke test with authorized test BVN.');
  } else {
    skip('BVN/identity live check', 'No authorized test BVN supplied');
  }

  skip('Transfers/cards/deposits', 'Money movement is not performed by readiness checks');
  printSummary();
}

function printSummary() {
  console.log('\nSummary');
  for (const result of results) {
    console.log(`${result.status.padEnd(6)} ${result.step}${result.detail ? ` - ${result.detail}` : ''}`);
  }
}

main().catch((error) => {
  results.push({ step: 'Unhandled error', status: 'FAIL', detail: error?.message || String(error) });
  console.error(error?.message || error);
  printSummary();
  process.exit(1);
});
