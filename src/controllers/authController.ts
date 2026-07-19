import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import jwt from 'jsonwebtoken';
import { EmailProviderError, sendOTPEmail } from '../services/emailNotification';
import { auditService } from '../services/auditService';
import { logger } from '../services/logger';


const OTP_EXPIRY_TIME = 5 * 60 * 1000; // 5 minutes
const RESET_OTP_EXPIRY_TIME = 10 * 60 * 1000; // 10 minutes
const GENERIC_OTP_RESPONSE = 'If the account can receive this request, an OTP has been sent.';

const generateOtp = () => crypto.randomInt(100000, 1000000).toString();
const isTestOtpBypassEnabled = () =>
  process.env.NODE_ENV !== 'production' &&
  process.env.ENABLE_TEST_OTP_BYPASS === 'true' &&
  /^\d{6}$/.test(process.env.TEST_OTP_CODE || '');
const getOtpCode = () => (isTestOtpBypassEnabled() ? process.env.TEST_OTP_CODE! : generateOtp());
const sendOtpIfRequired = async (email: string, otp: string) => {
  if (isTestOtpBypassEnabled()) {
    logger.warn('test_otp_bypass_enabled_for_non_production');
    return;
  }
  await sendOTPEmail(email, otp);
};

const emailProviderFailureResponse = (res: Response, error: unknown) => {
  if (error instanceof EmailProviderError) {
    const status = error.code === 'TEST_DATA_INVALID' ? 400 : 502;
    return res.status(status).json({
      message: 'Unable to send OTP email.',
      code: error.code,
    });
  }
  return res.status(500).json({ message: 'An error occurred while sending the OTP. Please try again later.' });
};

const hashOtp = (otp: string) => bcrypt.hash(otp, 10);

const isOtpValid = async (
  user: User,
  otp: string,
  purpose: 'account_verification' | 'password_reset'
) => {
  if (!user.otp || !user.otpExpiry || user.otpPurpose !== purpose) return false;
  if (new Date() > user.otpExpiry) return false;
  return bcrypt.compare(otp, user.otp);
};


// User Registration
export const registerUser = async (req: Request, res: Response) => {
  const { firstName, lastName, email, password, gender, phoneNumber } = req.body;

  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase();

  const existingUser = await userRepository.findOne({ where: [{ email: normalizedEmail }, { phoneNumber }] });
  if (existingUser) {
    return res.status(400).json({ message: 'User already exists with this email or phone number.' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const otp = getOtpCode();
  const otpExpiry = new Date(Date.now() + OTP_EXPIRY_TIME);

  try {
    await sendOtpIfRequired(normalizedEmail, otp);

    const user = new User();
    user.firstName = firstName;
    user.lastName = lastName;
    user.email = normalizedEmail;
    user.password = hashedPassword;
    user.gender = gender;
    user.phoneNumber = phoneNumber;
    user.otp = await hashOtp(otp);
    user.otpExpiry = otpExpiry;
    user.otpPurpose = 'account_verification';
    user.isVerified = false;

    try {
      await userRepository.save(user);
      res.status(200).json({ message: 'OTP sent to your email. Please verify to complete registration.' });
    } catch (error) {
      logger.error('registration_user_save_failed', error, { requestId: (req as any).id });
      return res.status(500).json({ message: 'An error occurred while saving the user. Please try again later.' });
    }

  } catch (error) {
    logger.error('registration_otp_send_failed', error, { requestId: (req as any).id });
    return emailProviderFailureResponse(res, error);
  }
};


// OTP Verification
export const verifyOtp = async (req: Request, res: Response) => {
  const { otp, email } = req.body; // Now expecting email and otp from the request

  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase();  // Normalize email
  
  const user = await userRepository.findOne({ where: { email: normalizedEmail } });  // Find user by email
  
  // Check if user exists
  if (!user) {
      logger.warn('otp_verification_user_not_found', { requestId: (req as any).id });
      return res.status(400).json({ message: 'User not found.' });
  }

  if (!(await isOtpValid(user, otp, 'account_verification'))) {
      return res.status(400).json({ message: 'Invalid OTP.' });
  }

  try {
      // Update user verification status and clear OTP fields
      user.isVerified = true;
      user.otp = null;
      user.otpExpiry = null;
      user.otpPurpose = null;
      await userRepository.save(user);
      logger.info('account_verified', { requestId: (req as any).id, userId: user.id });

      // Generate JWT after verification
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
          return res.status(500).json({ message: 'Internal server error.' });
      }
      const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '1h' });

      res.status(200).json({ token, message: 'Account verified. Please create your transaction PIN.' });
  } catch (error) {
      logger.error('otp_verification_failed', error, { requestId: (req as any).id });
      return res.status(500).json({ message: 'An error occurred while verifying the OTP. Please try again later.' });
  }
};

// Resend OTP
export const resendOtp = async (req: Request, res: Response) => {
  const { email } = req.body;

  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase();
  const user = await userRepository.findOne({ where: { email: normalizedEmail } });

  if (!user) {
    return res.status(200).json({ message: GENERIC_OTP_RESPONSE });
  }

  if (user.isVerified) {
    return res.status(400).json({ message: 'Your account is already verified. You can proceed to log in.' });
  }

  const newOtp = getOtpCode();
  const otpExpiry = new Date(Date.now() + OTP_EXPIRY_TIME);

  try {
    await sendOtpIfRequired(normalizedEmail, newOtp);

    user.otp = await hashOtp(newOtp);
    user.otpExpiry = otpExpiry;
    user.otpPurpose = 'account_verification';
    await userRepository.save(user);

    res.status(200).json({ message: 'A new OTP has been sent to your email. Please check and verify.' });
  } catch (error) {
    logger.error('otp_resend_failed', error, { requestId: (req as any).id });
    return emailProviderFailureResponse(res, error);
  }
};

// Create Transaction PIN
export const createTransactionPin = async (req: Request, res: Response) => {
  const { pin } = req.body; 

  if (!req.user?.id) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  if (!pin || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ message: 'PIN must be a 4-digit number.' });
  }

  const userRepository = AppDataSource.getRepository(User);
  const user = await userRepository.findOne({ where: { id: req.user.id } });

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const hashedPin = await bcrypt.hash(pin, 10);
  user.transactionPin = hashedPin;
  await userRepository.save(user);
  await auditService.log({ actorUserId: user.id, targetUserId: user.id, action: 'PIN_UPDATED', entityType: 'User', entityId: user.id, req });

  return res.status(200).json({ message: 'Transaction PIN set successfully.' });
};

// Login
export const loginUser = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase();
  const user = await userRepository.findOne({ where: { email: normalizedEmail } });

  if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ message: 'Invalid credentials. Please check your email and password and try again.' });
  }

  if (!user.isVerified) {
      return res.status(400).json({ message: 'Your account is not verified. Please verify your account to log in.' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
      return res.status(500).json({ message: 'Internal server error: JWT_SECRET is not defined in environment variables.' });
  }

  // Include user id and email in JWT
  const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '1h' });
  await auditService.log({ actorUserId: user.id, targetUserId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id, req });

  // Return user id in response alongside token
  res.status(200).json({
    token,
    userId: user.id,   // <-- new addition
    message: 'Login successful. Welcome back!'
  });
};


// Request Password Reset
export const requestPasswordReset = async (req: Request, res: Response) => {
  const { email } = req.body;
  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase();

  const user = await userRepository.findOne({ where: { email: normalizedEmail } });
  if (!user) {
    return res.status(200).json({ message: GENERIC_OTP_RESPONSE });
  }

  const otp = getOtpCode();
  const otpExpiry = new Date(Date.now() + RESET_OTP_EXPIRY_TIME);

  try {
    await sendOtpIfRequired(normalizedEmail, otp);

    user.otp = await hashOtp(otp);
    user.otpExpiry = otpExpiry;
    user.otpPurpose = 'password_reset';
    await userRepository.save(user);

    res.status(200).json({ message: GENERIC_OTP_RESPONSE });
  } catch (error) {
    logger.error('password_reset_otp_send_failed', error, { requestId: (req as any).id });
    return emailProviderFailureResponse(res, error);
  }
};

export const verifyOtpForPasswordReset = async (req: Request, res: Response) => {
  const { email, otp } = req.body;
  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase();

  const user = await userRepository.findOne({ where: { email: normalizedEmail } });
  if (!user) {
    return res.status(400).json({ message: 'No account found with this email address.' });
  }

  if (!(await isOtpValid(user, otp, 'password_reset'))) {
    return res.status(400).json({ message: 'Invalid OTP.' });
  }

  res.status(200).json({ message: 'OTP verified successfully. You can now reset your password.' });
};



// Reset Password
export const resetPassword = async (req: Request, res: Response) => {
  const { email, otp, newPassword } = req.body;
  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase();

  const user = await userRepository.findOne({ where: { email: normalizedEmail } });
  if (!user) {
    return res.status(400).json({ message: 'No account found with this email address.' });
  }

  if (!otp || !(await isOtpValid(user, otp, 'password_reset'))) {
    return res.status(400).json({ message: 'A valid password reset OTP is required.' });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedPassword;
  user.otp = null;
  user.otpExpiry = null;
  user.otpPurpose = null;
  await userRepository.save(user);
  await auditService.log({ actorUserId: user.id, targetUserId: user.id, action: 'PASSWORD_RESET', entityType: 'User', entityId: user.id, req });

  res.status(200).json({ message: 'Password reset successful. You can now log in with your new password.' });
};


export const makeAdmin = async (req: Request, res: Response) => {
  if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized. User not authenticated.' });
  }

  const { userId } = req.body;
  const userRepository = AppDataSource.getRepository(User);

  const user = await userRepository.findOne({ where: { id: userId } });
  if (!user) {
      return res.status(404).json({ message: 'User not found.' });
  }

  const requester = await userRepository.findOne({ where: { id: req.user.id } });
  if (!requester || requester.role !== 'super_admin') {
      return res.status(403).json({ message: 'Unauthorized. Only super admin can make changes.' });
  }

  user.role = 'admin';
  await userRepository.save(user);
  await auditService.log({ actorUserId: requester.id, targetUserId: user.id, action: 'ADMIN_ROLE_GRANTED', entityType: 'User', entityId: user.id, req });
  res.status(200).json({ message: 'User role updated to admin.' });
};
export const removeAdmin = async (req: Request, res: Response) => {
  // Check if req.user is defined
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized. User not authenticated.' });
  }

  const { userId } = req.body;
  const userRepository = AppDataSource.getRepository(User);

  // Check if the user exists in the database
  const user = await userRepository.findOne({ where: { id: userId } });
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  // Check if the requester is a super admin
  const requester = await userRepository.findOne({ where: { id: req.user.id } });
  if (!requester || requester.role !== 'super_admin') {
    return res.status(403).json({ message: 'Unauthorized. Only super admin can make changes.' });
  }

  // Remove admin rights
  user.role = 'user';
  await userRepository.save(user);
  await auditService.log({ actorUserId: requester.id, targetUserId: user.id, action: 'ADMIN_ROLE_REMOVED', entityType: 'User', entityId: user.id, req });

  res.status(200).json({ message: 'Admin rights removed successfully.' });
};
