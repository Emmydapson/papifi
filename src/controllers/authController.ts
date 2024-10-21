import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import jwt from 'jsonwebtoken';
import { sendOTPEmail } from '../services/emailNotification';
import payshigaService from '../services/walletService';

const OTP_EXPIRY_TIME = 5 * 60 * 1000; // 5 minutes

// User Registration
export const registerUser = async (req: Request, res: Response) => {
  const { fullName, email, password, gender } = req.body;

  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase();

  const existingUser = await userRepository.findOne({ where: { email: normalizedEmail } });
  if (existingUser) {
      return res.status(400).json({ message: 'User already exists. Please use a different email address.' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + OTP_EXPIRY_TIME);

  try {
      await sendOTPEmail(normalizedEmail, otp);

      const user = new User();
      user.fullName = fullName;
      user.email = normalizedEmail;
      user.password = hashedPassword;
      user.gender = gender;
      user.otp = otp;
      user.otpExpiry = otpExpiry;
      user.isVerified = false; 
      await userRepository.save(user);

      res.status(200).json({ message: 'OTP sent to your email. Please verify to complete registration.' });
  } catch (error) {
      console.error('Failed to send OTP:', error);
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
    await sendOTPEmail(normalizedEmail, newOtp);

    user.otp = newOtp;
    user.otpExpiry = otpExpiry;
    await userRepository.save(user);

    res.status(200).json({ message: 'A new OTP has been sent to your email. Please check and verify.' });
  } catch (error) {
    console.error('Failed to send new OTP:', error);
    return res.status(500).json({ message: 'An error occurred while sending the new OTP. Please try again later.' });
  }
};

// Create Transaction PIN
export const createTransactionPin = async (req: Request, res: Response) => {
  const { pin, email } = req.body; // Assuming email is sent with the request

  if (!pin || pin.length !== 4) {
    return res.status(400).json({ message: 'PIN must be a 4-digit number.' });
  }

  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase(); // Normalize email
  const user = await userRepository.findOne({ where: { email: normalizedEmail } });

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const hashedPin = await bcrypt.hash(pin, 10);
  user.transactionPin = hashedPin;
  await userRepository.save(user);

  try {
    await payshigaService.createWallet(user.id, 'NGN');
    await payshigaService.createWallet(user.id, 'USD');
    await payshigaService.createWallet(user.id, 'GBP');

    return res.status(200).json({ message: 'Transaction PIN created and wallets set up successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error creating wallets. Please try again later.' });
  }
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
