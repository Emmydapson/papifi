import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import jwt from 'jsonwebtoken';
import { sendOTPEmail } from '../services/emailNotification';
import payshigaService from '../services/walletService';

const OTP_EXPIRY_TIME = 5 * 60 * 1000; // 5 minutes
const RESET_OTP_EXPIRY_TIME = 10 * 60 * 1000; // 10 minutes


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
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + OTP_EXPIRY_TIME);

  try {
    console.log(`Attempting to send OTP to ${normalizedEmail}`);
    await sendOTPEmail(normalizedEmail, otp);
    console.log(`OTP successfully sent to ${normalizedEmail}`);

    const user = new User();
    user.firstName = firstName;
    user.lastName = lastName;
    user.email = normalizedEmail;
    user.password = hashedPassword;
    user.gender = gender;
    user.phoneNumber = phoneNumber;
    user.otp = otp;
    user.otpExpiry = otpExpiry;
    user.isVerified = false;

    try {
      await userRepository.save(user);
      console.log(`User saved successfully: ${normalizedEmail}`);
      res.status(200).json({ message: 'OTP sent to your email. Please verify to complete registration.' });
    } catch (error) {
      console.error('Error occurred while saving user:', error);
      return res.status(500).json({ message: 'An error occurred while saving the user. Please try again later.' });
    }

  } catch (error) {
    console.error('Error occurred during OTP sending:', error);
    return res.status(500).json({ message: 'An error occurred while sending the OTP. Please try again later.' });
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
      console.error('Verification attempt for non-existent user:', normalizedEmail);
      return res.status(400).json({ message: 'User not found.' });
  }

  // Check if OTP matches and is not expired
  if (user.otp !== otp) {
      console.error(`Invalid OTP for user ${normalizedEmail}. Expected: ${user.otp}, Provided: ${otp}`);
      return res.status(400).json({ message: 'Invalid OTP.' });
  }

  if (user.otpExpiry && new Date() > user.otpExpiry) {
      console.error(`OTP expired for user ${normalizedEmail}. Current time: ${new Date()}, OTP expiry: ${user.otpExpiry}`);
      return res.status(400).json({ message: 'OTP has expired.' });
  }

  try {
      // Update user verification status and clear OTP fields
      user.isVerified = true;
      user.otp = null;
      user.otpExpiry = null;
      await userRepository.save(user);
      console.log(`User ${normalizedEmail} successfully verified.`);

      // Generate JWT after verification
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
          return res.status(500).json({ message: 'Internal server error.' });
      }
      const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '1h' });

      res.status(200).json({ token, message: 'Account verified. Please create your transaction PIN.' });
  } catch (error) {
      console.error('Failed to verify OTP:', error);
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
    return res.status(400).json({ message: 'No account found associated with this email address.' });
  }

  if (user.isVerified) {
    return res.status(400).json({ message: 'Your account is already verified. You can proceed to log in.' });
  }

  const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + OTP_EXPIRY_TIME);

  try {
    console.log(`Attempting to resend OTP to ${normalizedEmail}`);
    await sendOTPEmail(normalizedEmail, newOtp);
    console.log(`OTP successfully resent to ${normalizedEmail}`);

    user.otp = newOtp;
    user.otpExpiry = otpExpiry;
    await userRepository.save(user);
    console.log(`User ${normalizedEmail} updated with new OTP`);

    res.status(200).json({ message: 'A new OTP has been sent to your email. Please check and verify.' });
  } catch (error) {
    console.error('Failed to resend OTP:', error);
    return res.status(500).json({ message: 'An error occurred while sending the new OTP. Please try again later.' });
  }
};

// Create Transaction PIN
export const createTransactionPin = async (req: Request, res: Response) => {
  const { pin, email } = req.body; 

  if (!pin || pin.length !== 4) {
    return res.status(400).json({ message: 'PIN must be a 4-digit number.' });
  }

  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase(); 
  const user = await userRepository.findOne({ where: { email: normalizedEmail } });

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const hashedPin = await bcrypt.hash(pin, 10);
  user.transactionPin = hashedPin;
  await userRepository.save(user);

  return res.status(200).json({ message: 'Transaction PIN set successfully.' });
};

// Login
export const loginUser = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase();
  const user = await userRepository.findOne({ where: { email: normalizedEmail } });

  if (!user || !(await bcrypt.compare(password, user.password))) {
      console.error('Invalid login attempt:', { email: normalizedEmail, valid: user !== null });
      return res.status(400).json({ message: 'Invalid credentials. Please check your email and password and try again.' });
  }

  if (!user.isVerified) {
      console.error('User not verified:', user.email);
      return res.status(400).json({ message: 'Your account is not verified. Please verify your account to log in.' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
      return res.status(500).json({ message: 'Internal server error: JWT_SECRET is not defined in environment variables.' });
  }

  const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '1h' });

  res.status(200).json({ token, message: 'Login successful. Welcome back!' });
};

// Request Password Reset
export const requestPasswordReset = async (req: Request, res: Response) => {
  const { email } = req.body;
  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase();

  const user = await userRepository.findOne({ where: { email: normalizedEmail } });
  if (!user) {
    return res.status(400).json({ message: 'No account found with this email address.' });
  }

  // Generate OTP for password reset
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + RESET_OTP_EXPIRY_TIME);

  try {
    console.log(`Attempting to send password reset OTP to ${normalizedEmail}`);
    await sendOTPEmail(normalizedEmail, otp);
    console.log(`Password reset OTP successfully sent to ${normalizedEmail}`);

    // Save OTP and expiry to user record
    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await userRepository.save(user);

    res.status(200).json({ message: 'A password reset OTP has been sent to your email.' });
  } catch (error) {
    console.error('Failed to send password reset OTP:', error);
    return res.status(500).json({ message: 'An error occurred while sending the OTP. Please try again later.' });
  }
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

  // Verify OTP
  if (user.otp !== otp) {
    return res.status(400).json({ message: 'Invalid OTP.' });
  }

  if (user.otpExpiry && new Date() > user.otpExpiry) {
    return res.status(400).json({ message: 'OTP has expired.' });
  }

  // Hash new password and update the user record
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedPassword;
  user.otp = null;
  user.otpExpiry = null;
  await userRepository.save(user);

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

  res.status(200).json({ message: 'Admin rights removed successfully.' });
};
