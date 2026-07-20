import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMapleradConfig } from '../config/maplerad';

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.MAPLERAD_ENVIRONMENT;
  delete process.env.MAPLERAD_SANDBOX_BASE_URL;
  delete process.env.MAPLERAD_SANDBOX_SECRET_KEY;
  delete process.env.MAPLERAD_PRODUCTION_BASE_URL;
  delete process.env.MAPLERAD_PRODUCTION_SECRET_KEY;
  delete process.env.MAPLERAD_BASE_URL;
  delete process.env.MAPLERAD_SECRET_KEY;
  delete process.env.MAPLERAD_SECRET;
  delete process.env.MAPLERAD_ALLOW_PRODUCTION_SANDBOX;
  delete process.env.MAPLERAD_ALLOW_CUSTOM_BASE_URL;
  delete process.env.MAPLERAD_WEBHOOK_VERIFICATION_MODE;
  delete process.env.MAPLERAD_SANDBOX_WEBHOOK_SECRET;
  delete process.env.MAPLERAD_PRODUCTION_WEBHOOK_SECRET;
  delete process.env.MAPLERAD_WEBHOOK_ALLOWED_IPS;
}

function setWebhookSecret(environment: 'sandbox' | 'production' = 'sandbox') {
  process.env[`MAPLERAD_${environment.toUpperCase()}_WEBHOOK_SECRET`] = `whsec_${Buffer.from(`${environment}-webhook-secret`).toString('base64')}`;
}

test.afterEach(resetEnv);

test('Maplerad config defaults development to sandbox', () => {
  resetEnv();
  process.env.NODE_ENV = 'development';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sandbox-secret';
  setWebhookSecret('sandbox');

  const config = resolveMapleradConfig();
  assert.equal(config.environment, 'sandbox');
  assert.equal(config.baseUrl, 'https://api.maplerad.com/v1');
  assert.equal(config.secretKey, 'sandbox-secret');
});

test('Maplerad config resolves production explicitly', () => {
  resetEnv();
  process.env.NODE_ENV = 'production';
  process.env.MAPLERAD_ENVIRONMENT = 'production';
  process.env.MAPLERAD_PRODUCTION_SECRET_KEY = 'production-secret';
  setWebhookSecret('production');

  const config = resolveMapleradConfig();
  assert.equal(config.environment, 'production');
  assert.equal(config.secretKey, 'production-secret');
});

test('Maplerad config rejects production app using sandbox without override', () => {
  resetEnv();
  process.env.NODE_ENV = 'production';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sandbox-secret';

  assert.throws(() => resolveMapleradConfig(), /Refusing MAPLERAD_ENVIRONMENT=sandbox/);
});

test('Maplerad config allows production app sandbox only with explicit override', () => {
  resetEnv();
  process.env.NODE_ENV = 'production';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_ALLOW_PRODUCTION_SANDBOX = 'true';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sandbox-secret';
  setWebhookSecret('sandbox');

  assert.equal(resolveMapleradConfig().environment, 'sandbox');
});

test('Maplerad config rejects sandbox environment with only production key', () => {
  resetEnv();
  process.env.NODE_ENV = 'staging';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_PRODUCTION_SECRET_KEY = 'production-secret';

  assert.throws(() => resolveMapleradConfig(), /requires MAPLERAD_SANDBOX_SECRET_KEY/);
});

test('Maplerad config rejects production environment with only sandbox key', () => {
  resetEnv();
  process.env.NODE_ENV = 'production';
  process.env.MAPLERAD_ENVIRONMENT = 'production';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sandbox-secret';

  assert.throws(() => resolveMapleradConfig(), /requires MAPLERAD_PRODUCTION_SECRET_KEY/);
});

test('Maplerad config rejects missing selected secret', () => {
  resetEnv();
  process.env.NODE_ENV = 'development';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';

  assert.throws(() => resolveMapleradConfig(), /Missing Maplerad sandbox secret key/);
});

test('Maplerad config rejects non-official base URL without override', () => {
  resetEnv();
  process.env.NODE_ENV = 'development';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sandbox-secret';
  process.env.MAPLERAD_SANDBOX_BASE_URL = 'https://sandbox.maplerad.example/v1';
  setWebhookSecret('sandbox');

  assert.throws(() => resolveMapleradConfig(), /official API URL/);
});

test('Maplerad config accepts valid whsec webhook secret', () => {
  resetEnv();
  process.env.NODE_ENV = 'development';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sandbox-secret';
  setWebhookSecret('sandbox');

  const config = resolveMapleradConfig();
  assert.equal(config.webhookSecretConfigured, true);
  assert.equal(config.webhookSecretFormatValid, true);
});

test('Maplerad config rejects malformed webhook secret', () => {
  resetEnv();
  process.env.NODE_ENV = 'development';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sandbox-secret';
  process.env.MAPLERAD_SANDBOX_WEBHOOK_SECRET = 'not-a-whsec';

  assert.throws(() => resolveMapleradConfig(), /must begin with whsec_/);
});

test('Maplerad config rejects API secret incorrectly supplied as webhook secret', () => {
  resetEnv();
  process.env.NODE_ENV = 'development';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sk_test_api_secret';
  process.env.MAPLERAD_SANDBOX_WEBHOOK_SECRET = 'sk_test_api_secret';

  assert.throws(() => resolveMapleradConfig(), /must begin with whsec_/);
});

test('Maplerad config rejects missing webhook secret in signature mode', () => {
  resetEnv();
  process.env.NODE_ENV = 'development';
  process.env.MAPLERAD_ENVIRONMENT = 'sandbox';
  process.env.MAPLERAD_SANDBOX_SECRET_KEY = 'sandbox-secret';
  process.env.MAPLERAD_WEBHOOK_VERIFICATION_MODE = 'signature';

  assert.throws(() => resolveMapleradConfig(), /requires MAPLERAD_SANDBOX_WEBHOOK_SECRET/);
});

test('Maplerad config rejects disabled webhook verification in production', () => {
  resetEnv();
  process.env.NODE_ENV = 'production';
  process.env.MAPLERAD_ENVIRONMENT = 'production';
  process.env.MAPLERAD_PRODUCTION_SECRET_KEY = 'production-secret';
  process.env.MAPLERAD_WEBHOOK_VERIFICATION_MODE = 'disabled';

  assert.throws(() => resolveMapleradConfig(), /disabled is not allowed in production/);
});
