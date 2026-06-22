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
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const code = axios.isAxiosError(error) ? error.code : undefined;
    logger.error(`${eventName}_failed`, new Error('Email provider request failed'), {
      provider,
      status,
      code,
    });
    throw new Error('Could not send email');
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
