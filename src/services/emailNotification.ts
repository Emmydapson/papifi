import nodemailer from 'nodemailer';
import { logger } from './logger';

// Create a transporter object using SMTP transport
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT!, 10),
  secure: true, // Use true if you're using port 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  logger: false,
  debug: false,
  tls: {
    rejectUnauthorized: false, // Set to true if using self-signed certificates
  },
});

// Function to send OTP email
export const sendOTPEmail = async (email: string, otp: string) => {
  try {
    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL, // Sender email address
      to: email, // Recipient email
      subject: 'Your OTP Code',
      text: `Your verification code is ${otp}, expires in 10 minutes`,
    };

    await transporter.sendMail(mailOptions);
    logger.info('otp_email_sent');
  } catch (error) {
    logger.error('otp_email_failed', error);
    throw new Error('Could not send OTP email');
  }
};

// Function to send password change notification email
export const sendPasswordChangeNotification = async (email: string) => {
  try {
    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL, // Sender email address
      to: email, // Recipient email
      subject: 'Password Changed Successfully',
      text: 'Your password has been changed successfully. If this was not you, please contact support immediately.',
    };

    await transporter.sendMail(mailOptions);
    logger.info('password_change_notification_sent');
  } catch (error) {
    logger.error('password_change_notification_failed', error);
    throw new Error('Could not send password change notification');
  }
};
