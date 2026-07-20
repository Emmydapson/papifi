export type MapleradEnvironment = 'sandbox' | 'production';
export type MapleradWebhookVerificationMode = 'signature' | 'ip_and_requery' | 'disabled';

export type ResolvedMapleradConfig = {
  environment: MapleradEnvironment;
  baseUrl: string;
  secretKey: string;
  publicKey?: string;
  webhookSecret?: string;
  previousWebhookSecret?: string;
  webhookVerificationMode: MapleradWebhookVerificationMode;
  webhookSecretConfigured: boolean;
  webhookSecretFormatValid: boolean | 'not-configured';
  webhookAllowedIps: string[];
};

const officialBaseUrl = 'https://api.maplerad.com/v1';
const officialWebhookSourceIps = [
  '54.216.8.72',
  '54.173.54.49',
  '52.215.16.239',
  '52.55.123.25',
  '52.6.93.106',
  '63.33.109.123',
  '44.228.126.217',
  '50.112.21.217',
  '52.24.126.164',
  '54.148.139.208',
];

const normalizeBaseUrl = (url: string) => {
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
};

const defaultEnvironment = (): MapleradEnvironment => {
  if (process.env.NODE_ENV === 'production') return 'production';
  return 'sandbox';
};

const selectedEnvironment = (): MapleradEnvironment => {
  const configured = (process.env.MAPLERAD_ENVIRONMENT || '').trim().toLowerCase();
  if (!configured) return defaultEnvironment();
  if (configured === 'sandbox' || configured === 'production') return configured;
  throw new Error('MAPLERAD_ENVIRONMENT must be either sandbox or production');
};

const hasValue = (value?: string) => Boolean(value && value.trim() && value !== 'replace-me');

const environmentSecret = (environment: MapleradEnvironment) =>
  environment === 'sandbox' ? process.env.MAPLERAD_SANDBOX_SECRET_KEY : process.env.MAPLERAD_PRODUCTION_SECRET_KEY;

const environmentPublicKey = (environment: MapleradEnvironment) =>
  environment === 'sandbox' ? process.env.MAPLERAD_SANDBOX_PUBLIC_KEY : process.env.MAPLERAD_PRODUCTION_PUBLIC_KEY;

const environmentWebhookSecret = (environment: MapleradEnvironment) =>
  environment === 'sandbox' ? process.env.MAPLERAD_SANDBOX_WEBHOOK_SECRET : process.env.MAPLERAD_PRODUCTION_WEBHOOK_SECRET;

const environmentPreviousWebhookSecret = (environment: MapleradEnvironment) =>
  environment === 'sandbox'
    ? process.env.MAPLERAD_SANDBOX_PREVIOUS_WEBHOOK_SECRET
    : process.env.MAPLERAD_PRODUCTION_PREVIOUS_WEBHOOK_SECRET;

const parseWebhookMode = (): MapleradWebhookVerificationMode => {
  const mode = (process.env.MAPLERAD_WEBHOOK_VERIFICATION_MODE || 'signature').trim().toLowerCase();
  if (mode === 'signature' || mode === 'ip_and_requery' || mode === 'disabled') return mode;
  throw new Error('MAPLERAD_WEBHOOK_VERIFICATION_MODE must be signature, ip_and_requery, or disabled');
};

const webhookSecretFormat = (secret?: string): boolean | 'not-configured' => {
  if (!hasValue(secret)) return 'not-configured';
  return secret!.startsWith('whsec_');
};

const parseCsv = (value?: string) =>
  (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export const resolveMapleradConfig = (options: { allowMissingSignatureSecret?: boolean; allowMalformedWebhookSecret?: boolean } = {}): ResolvedMapleradConfig => {
  const environment = selectedEnvironment();
  if (
    process.env.NODE_ENV === 'production' &&
    environment === 'sandbox' &&
    process.env.MAPLERAD_ALLOW_PRODUCTION_SANDBOX !== 'true'
  ) {
    throw new Error('Refusing MAPLERAD_ENVIRONMENT=sandbox under NODE_ENV=production without MAPLERAD_ALLOW_PRODUCTION_SANDBOX=true');
  }

  const baseUrl = normalizeBaseUrl(
    (environment === 'sandbox' ? process.env.MAPLERAD_SANDBOX_BASE_URL : process.env.MAPLERAD_PRODUCTION_BASE_URL) ||
      process.env.MAPLERAD_BASE_URL ||
      officialBaseUrl
  );

  if (!baseUrl.startsWith('https://')) throw new Error('Maplerad API base URL must use HTTPS');
  if (baseUrl !== officialBaseUrl && process.env.MAPLERAD_ALLOW_CUSTOM_BASE_URL !== 'true') {
    throw new Error('Maplerad base URL must match the official API URL unless MAPLERAD_ALLOW_CUSTOM_BASE_URL=true');
  }

  const sandboxSecret = process.env.MAPLERAD_SANDBOX_SECRET_KEY;
  const productionSecret = process.env.MAPLERAD_PRODUCTION_SECRET_KEY;
  const selectedSecret = environmentSecret(environment);
  const legacySecret = process.env.MAPLERAD_SECRET_KEY || process.env.MAPLERAD_SECRET;

  if (environment === 'sandbox' && !hasValue(selectedSecret) && hasValue(productionSecret)) {
    throw new Error('MAPLERAD_ENVIRONMENT=sandbox requires MAPLERAD_SANDBOX_SECRET_KEY; refusing production key fallback');
  }
  if (environment === 'production' && !hasValue(selectedSecret) && hasValue(sandboxSecret)) {
    throw new Error('MAPLERAD_ENVIRONMENT=production requires MAPLERAD_PRODUCTION_SECRET_KEY; refusing sandbox key fallback');
  }

  const secretKey = selectedSecret || legacySecret;
  if (!hasValue(secretKey)) throw new Error(`Missing Maplerad ${environment} secret key`);

  const webhookVerificationMode = parseWebhookMode();
  if (process.env.NODE_ENV === 'production' && webhookVerificationMode === 'disabled') {
    throw new Error('MAPLERAD_WEBHOOK_VERIFICATION_MODE=disabled is not allowed in production');
  }

  const webhookSecret = environmentWebhookSecret(environment);
  const previousWebhookSecret = environmentPreviousWebhookSecret(environment);
  const webhookSecretConfigured = hasValue(webhookSecret);
  const webhookSecretFormatValid = webhookSecretFormat(webhookSecret);
  const previousWebhookSecretFormatValid = webhookSecretFormat(previousWebhookSecret);

  if ((webhookSecretFormatValid === false || previousWebhookSecretFormatValid === false) && !options.allowMalformedWebhookSecret) {
    throw new Error('Configured Maplerad webhook signing secrets must begin with whsec_');
  }
  if (webhookVerificationMode === 'signature' && !webhookSecretConfigured && !options.allowMissingSignatureSecret) {
    throw new Error(`MAPLERAD_WEBHOOK_VERIFICATION_MODE=signature requires MAPLERAD_${environment.toUpperCase()}_WEBHOOK_SECRET`);
  }

  return {
    environment,
    baseUrl,
    secretKey: secretKey!,
    publicKey:
      environmentPublicKey(environment) ||
      (environment === 'sandbox' ? undefined : process.env.MAPLERAD_PUBLIC_KEY || process.env.MAPLERAD_PUBLIC),
    webhookSecret: webhookSecretConfigured ? webhookSecret : undefined,
    previousWebhookSecret: hasValue(previousWebhookSecret) ? previousWebhookSecret : undefined,
    webhookVerificationMode,
    webhookSecretConfigured,
    webhookSecretFormatValid,
    webhookAllowedIps: parseCsv(process.env.MAPLERAD_WEBHOOK_ALLOWED_IPS || officialWebhookSourceIps.join(',')),
  };
};

export const mapleradStartupSummary = () => {
  const config = resolveMapleradConfig();
  return {
    provider: 'maplerad',
    environment: config.environment,
    baseUrl: config.baseUrl,
    secretConfigured: Boolean(config.secretKey),
  };
};
