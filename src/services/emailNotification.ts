import axios from 'axios';
import nodemailer, { Transporter } from 'nodemailer';
import { logger } from './logger';

type EmailProvider = 'resend' | 'smtp';

interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
let smtpTransporter: Transporter | undefined;

export type EmailProviderErrorCode =
  | 'TEST_DATA_INVALID'
  | 'EMAIL_PROVIDER_AUTH_FAILED'
  | 'EMAIL_SENDER_NOT_VERIFIED'
  | 'EMAIL_PROVIDER_UNAVAILABLE'
  | 'EMAIL_PROVIDER_FAILED';

export class EmailProviderError extends Error {
  constructor(
    public readonly code: EmailProviderErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'EmailProviderError';
  }
}

const getEmailProvider = (): EmailProvider => {
  const provider = process.env.EMAIL_PROVIDER?.toLowerCase();
  if (provider === 'resend' || provider === 'smtp') return provider;
  throw new Error('EMAIL_PROVIDER must be either resend or smtp');
};

const requiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the configured email provider`);
  return value;
};

const getHttpTimeout = () => {
  const configured = Number(process.env.EMAIL_HTTP_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_HTTP_TIMEOUT_MS;
};

const getSmtpTransporter = () => {
  if (smtpTransporter) return smtpTransporter;

  const port = Number(requiredEnv('SMTP_PORT'));
  if (!Number.isInteger(port) || port <= 0) throw new Error('SMTP_PORT must be a valid port');

  smtpTransporter = nodemailer.createTransport({
    host: requiredEnv('SMTP_HOST'),
    port,
    secure: port === 465,
    auth: {
      user: requiredEnv('SMTP_USER'),
      pass: requiredEnv('SMTP_PASS'),
    },
    connectionTimeout: getHttpTimeout(),
    greetingTimeout: getHttpTimeout(),
    socketTimeout: getHttpTimeout(),
    logger: false,
    debug: false,
  });

  return smtpTransporter;
};

const sendWithResend = async (message: EmailMessage) => {
  await axios.post(
    RESEND_API_URL,
    {
      from: requiredEnv('SMTP_FROM_EMAIL'),
      to: [message.to],
      subject: message.subject,
      text: message.text,
    },
    {
      headers: {
        Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      timeout: getHttpTimeout(),
    },
  );
};

const classifyEmailProviderError = (error: unknown): EmailProviderError => {
  if (!axios.isAxiosError(error)) {
    return new EmailProviderError('EMAIL_PROVIDER_FAILED', 'Email provider request failed');
  }

  const status = error.response?.status;
  const code = error.code;
  const body: any = error.response?.data || {};
  const providerMessage = String(body.message || body.error || error.message || '').toLowerCase();
  const providerName = String(body.name || '').toLowerCase();

  if (status === 422 && (providerName.includes('validation') || providerMessage.includes('invalid `to`') || providerMessage.includes('invalid to'))) {
    return new EmailProviderError('TEST_DATA_INVALID', 'Email recipient test data is invalid or reserved', status);
  }
  if (status === 401 || status === 403 || providerMessage.includes('api key') || providerMessage.includes('unauthorized')) {
    return new EmailProviderError('EMAIL_PROVIDER_AUTH_FAILED', 'Email provider authentication failed', status);
  }
  if (
    providerMessage.includes('domain is not verified') ||
    providerMessage.includes('verify a domain') ||
    providerMessage.includes('sender') ||
    providerMessage.includes('from')
  ) {
    return new EmailProviderError('EMAIL_SENDER_NOT_VERIFIED', 'Email sender domain is not verified', status);
  }
  if (!status || code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
    return new EmailProviderError('EMAIL_PROVIDER_UNAVAILABLE', 'Email provider is unavailable', status);
  }

  return new EmailProviderError('EMAIL_PROVIDER_FAILED', 'Email provider request failed', status);
};

const sendEmail = async (message: EmailMessage, eventName: string) => {
  let provider: EmailProvider | 'unconfigured' = 'unconfigured';

  try {
    provider = getEmailProvider();
    if (provider === 'resend') {
      await sendWithResend(message);
    } else {
      await getSmtpTransporter().sendMail({
        from: requiredEnv('SMTP_FROM_EMAIL'),
        ...message,
      });
    }
    logger.info(`${eventName}_sent`, { provider });
  } catch (error) {
    const classified = classifyEmailProviderError(error);
    const code = axios.isAxiosError(error) ? error.code : undefined;
    logger.error(`${eventName}_failed`, classified, {
      provider,
      status: classified.status,
      classification: classified.code,
      code,
    });
    throw classified;
  }
};

export const sendOTPEmail = async (email: string, otp: string) => {
  await sendEmail(
    {
      to: email,
      subject: 'Your OTP Code',
      text: `Your verification code is ${otp}, expires in 10 minutes`,
    },
    'otp_email',
  );
};

export const sendPasswordChangeNotification = async (email: string) => {
  await sendEmail(
    {
      to: email,
      subject: 'Password Changed Successfully',
      text: 'Your password has been changed successfully. If this was not you, please contact support immediately.',
    },
    'password_change_notification',
  );
};
