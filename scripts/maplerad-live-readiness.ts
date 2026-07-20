import 'dotenv/config';
import crypto from 'crypto';
import axios, { AxiosError } from 'axios';
import { resolveMapleradConfig } from '../src/config/maplerad';

type StepStatus = 'PASS' | 'FAIL' | 'SKIP';

type StepResult = {
  step: string;
  status: StepStatus;
  detail?: string;
};

const results: StepResult[] = [];
const config = resolveMapleradConfig({ allowMissingSignatureSecret: true, allowMalformedWebhookSecret: true });
const secretKey = config.secretKey;
const environment = config.environment;
const sandboxTestsEnabled = process.env.MAPLERAD_SANDBOX_TESTS_ENABLED === 'true';
const sandboxCustomerCreationEnabled = process.env.MAPLERAD_SANDBOX_CUSTOMER_CREATION_ENABLED === 'true';
const sandboxWalletCreationEnabled = process.env.MAPLERAD_SANDBOX_WALLET_CREATION_ENABLED === 'true';
const deprecatedLiveTestsEnabled = process.env.MAPLERAD_LIVE_TESTS_ENABLED === 'true';
const testEmail = process.env.MAPLERAD_SANDBOX_TEST_EMAIL || process.env.MAPLERAD_LIVE_TEST_CUSTOMER_EMAIL;
const testPhone = process.env.MAPLERAD_SANDBOX_TEST_PHONE || process.env.MAPLERAD_LIVE_TEST_PHONE;
const testBvn = process.env.MAPLERAD_SANDBOX_TEST_BVN || process.env.MAPLERAD_LIVE_TEST_BVN;
const outputFile = process.env.MAPLERAD_READINESS_OUTPUT_FILE;
const baseUrl = config.baseUrl;

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
  console.log('Maplerad readiness check');
  console.log(`Environment: ${environment}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Secret key configured: ${secretKey ? 'yes' : 'no'}`);
  console.log(`Webhook verification mode: ${config.webhookVerificationMode}`);
  console.log(`Webhook signing secret configured: ${config.webhookSecretConfigured ? 'yes' : 'no'}`);
  console.log(
    `Webhook signing secret format valid: ${
      config.webhookSecretFormatValid === 'not-configured' ? 'not-configured' : config.webhookSecretFormatValid ? 'yes' : 'no'
    }`
  );
  console.log(`Sandbox tests enabled: ${sandboxTestsEnabled ? 'yes' : 'no'}`);
  console.log(`Sandbox customer creation enabled: ${sandboxCustomerCreationEnabled ? 'yes' : 'no'}`);
  console.log(`Sandbox wallet creation enabled: ${sandboxWalletCreationEnabled ? 'yes' : 'no'}`);
  if (deprecatedLiveTestsEnabled) {
    console.log('Warning: MAPLERAD_LIVE_TESTS_ENABLED is deprecated and ignored by readiness. Use MAPLERAD_SANDBOX_TESTS_ENABLED for sandbox checks.');
  }

  await step('Configuration', async () => {
    if (!secretKey) throw new Error('Missing MAPLERAD_SECRET_KEY or MAPLERAD_SECRET');
    if (!baseUrl.startsWith('https://')) throw new Error('Maplerad base URL must use HTTPS');
    if (config.webhookVerificationMode === 'signature' && !config.webhookSecretConfigured) {
      throw new Error(`signature mode requires MAPLERAD_${environment.toUpperCase()}_WEBHOOK_SECRET from Maplerad`);
    }
    if (config.webhookSecretFormatValid === false) {
      throw new Error('configured Maplerad webhook signing secret is malformed; it must begin with whsec_ and must not be an API key');
    }
    if (config.webhookVerificationMode === 'ip_and_requery') {
      console.log('Warning: webhook signature verification is unavailable; ip_and_requery is a temporary fallback and not equivalent to signature verification.');
    }
    return 'secret present, HTTPS base URL configured';
  });

  await step('Authentication and IP authorization', async () => {
    const response = await providerRequest('GET', '/customers?page=1&page_size=1');
    const body: any = response.data;
    if (!body || typeof body !== 'object') throw new Error('Schema mismatch: expected JSON object response');
    return 'GET /customers succeeded';
  });

  if (environment === 'sandbox' && sandboxTestsEnabled && sandboxCustomerCreationEnabled) {
    if (!testEmail) {
      skip('Sandbox tier 0 test customer creation', 'MAPLERAD_SANDBOX_TEST_EMAIL is required');
    } else {
      await step('Sandbox tier 0 test customer creation', async () => {
        const localPart = testEmail.split('@')[0] || 'papafi';
        const response = await providerRequest('POST', '/customers', {
          first_name: 'Papafi',
          last_name: `Readiness ${localPart.slice(-8)}`,
          email: testEmail,
          country: 'NG',
        });
        const data: any = response.data?.data || response.data;
        if (!data?.id) throw new Error('Schema mismatch: customer response did not include an id');
        const instruction = `npm run maplerad:reconcile-customer -- --user-id <papafi-user-id> --maplerad-customer-id ${data.id} --confirm`;
        if (outputFile) {
          const fs = await import('fs');
          fs.writeFileSync(
            outputFile,
            JSON.stringify(
              {
                mapleradCustomerId: data.id,
                email: '[redacted]',
                reconciliationInstruction: instruction,
                warning: 'This readiness customer is not linked to any Papafi user until reconciled explicitly.',
              },
              null,
              2
            )
          );
        }
        console.log(`  Maplerad customer id: ${data.id}`);
        console.log(`  Reconcile with: ${instruction}`);
        return 'created sandbox readiness customer; explicit reconciliation required before Papafi wallet creation';
      });
    }
  } else if (environment === 'production') {
    skip('Sandbox tier 0 test customer creation', 'active environment is production; readiness will not create production customers');
  } else {
    skip('Sandbox tier 0 test customer creation', 'requires MAPLERAD_SANDBOX_TESTS_ENABLED=true and MAPLERAD_SANDBOX_CUSTOMER_CREATION_ENABLED=true');
  }

  if (environment === 'sandbox' && sandboxTestsEnabled && testBvn) {
    await step('Sandbox BVN/identity check', async () => {
      const response = await providerRequest('POST', '/identity/bvn', { bvn: testBvn });
      if (!response.data || typeof response.data !== 'object') throw new Error('Schema mismatch: expected JSON object response');
      return 'sandbox BVN endpoint accepted documented test value';
    });
  } else {
    skip('Sandbox BVN/identity check', 'requires sandbox mode, MAPLERAD_SANDBOX_TESTS_ENABLED=true, and official MAPLERAD_SANDBOX_TEST_BVN');
  }

  if (environment === 'sandbox' && sandboxTestsEnabled && sandboxWalletCreationEnabled) {
    skip('Sandbox virtual-account creation', 'not run directly by readiness without a Papafi user/customer reconciliation flow');
  } else {
    skip('Sandbox virtual-account creation', 'requires MAPLERAD_SANDBOX_WALLET_CREATION_ENABLED=true and should be tested through Papafi wallet onboarding');
  }

  skip('Transfers/cards/deposits', 'Money movement and issuing are not performed by readiness checks');
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
