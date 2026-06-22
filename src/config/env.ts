const productionRequiredEnv = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_NAME',
  'JWT_SECRET',
  'SESSION_SECRET',
  'EMAIL_PROVIDER',
  'SMTP_FROM_EMAIL',
  'MAPLERAD_SECRET_KEY',
  'MAPLERAD_PUBLIC_KEY',
  'MAPLERAD_WEBHOOK_SECRET',
  'CORS_ALLOWED_ORIGINS',
];

const placeholderValues = new Set(['replace-me', 'replace-with-long-random-secret']);

export const validateEnv = () => {
  const hasUsableEnv = (...names: string[]) =>
    names.some((name) => {
      const value = process.env[name];
      return value && !placeholderValues.has(value);
    });

  const missingMaplerad = [
    !hasUsableEnv('MAPLERAD_SECRET_KEY', 'MAPLERAD_SECRET') && 'MAPLERAD_SECRET_KEY or MAPLERAD_SECRET',
    !hasUsableEnv('MAPLERAD_PUBLIC_KEY', 'MAPLERAD_PUBLIC') && 'MAPLERAD_PUBLIC_KEY or MAPLERAD_PUBLIC',
    !hasUsableEnv('MAPLERAD_WEBHOOK_SECRET') && 'MAPLERAD_WEBHOOK_SECRET',
  ].filter(Boolean);

  if (missingMaplerad.length > 0) {
    throw new Error(`Missing required Maplerad env vars: ${missingMaplerad.join(', ')}`);
  }

  if (process.env.NODE_ENV !== 'production') return;

  const emailProvider = process.env.EMAIL_PROVIDER?.toLowerCase();
  if (emailProvider !== 'resend' && emailProvider !== 'smtp') {
    throw new Error('EMAIL_PROVIDER must be either resend or smtp');
  }

  const missing = productionRequiredEnv.filter((name) => !process.env[name]);
  const providerRequiredEnv = emailProvider === 'resend'
    ? ['RESEND_API_KEY']
    : ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  missing.push(...providerRequiredEnv.filter((name) => !process.env[name]));
  if (missing.length > 0) {
    throw new Error(`Missing required production env vars: ${missing.join(', ')}`);
  }
};
