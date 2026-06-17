const productionRequiredEnv = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_NAME',
  'JWT_SECRET',
  'SESSION_SECRET',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM_EMAIL',
  'MAPLERAD_SECRET_KEY',
  'MAPLERAD_PUBLIC_KEY',
  'MAPLERAD_WEBHOOK_SECRET',
  'CORS_ALLOWED_ORIGINS',
];

export const validateEnv = () => {
  if (process.env.NODE_ENV !== 'production') return;

  const missing = productionRequiredEnv.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required production env vars: ${missing.join(', ')}`);
  }
};
