import { resolveMapleradConfig } from './maplerad';

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
  'CORS_ALLOWED_ORIGINS',
];

export const validateEnv = () => {
  resolveMapleradConfig();

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
