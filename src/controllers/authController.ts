import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import jwt from 'jsonwebtoken';
import { sendOTPEmail } from '../services/emailNotification';
import payshigaService from '../services/walletService';


const OTP_EXPIRY_TIME = 5 * 60 * 1000; // OTP valid for 5 minutes (in milliseconds)

export const registerUser = async (req: Request, res: Response) => {
  const { fullName, email, password, gender, confirmPassword } = req.body;

  // Check if passwords match
  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match. Please ensure both fields are identical.' });
  }

  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase();

  // Check if user already exists
  const existingUser = await userRepository.findOne({ where: { email: normalizedEmail } });
  if (existingUser) {
    return res.status(400).json({ message: 'User already exists. Please use a different email address.' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + OTP_EXPIRY_TIME); // OTP expires in 5 minutes

  try {
    // Send OTP email
    await sendOTPEmail(normalizedEmail, otp);

    // Create the user and save the OTP and expiry in the database
    const user = new User();
    user.email = normalizedEmail;
    user.password = hashedPassword;
    user.otp = otp;  // Save OTP in the user record
    user.otpExpiry = otpExpiry;  // Save OTP expiry in the user record
    await userRepository.save(user);

    res.status(200).json({ message: 'OTP sent to your email. Please verify to complete registration.' });
  } catch (error) {
    console.error('Failed to send OTP:', error);
    return res.status(500).json({ message: 'An error occurred while sending the OTP. Please try again later.' });
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  const { otp } = req.body;  // No email required

  const userRepository = AppDataSource.getRepository(User);

  
  const user = await userRepository.findOne({ where: { id: req.user?.userId } });

  if (!user) {
    return res.status(400).json({ message: 'User not found.' });
  }

  if (user.isVerified) {
    return res.status(400).json({ message: 'Your account is already verified.' });
  }

  // Validate OTP
  if (user.otp !== otp || user.otpExpiry && user.otpExpiry < new Date()) {
    return res.status(400).json({ message: 'Invalid or expired OTP.' });
  }

  try {
    // Mark user as verified and clear OTP details
    user.isVerified = true;
    user.otp = null;
    user.otpExpiry = null;
    await userRepository.save(user);

    // Generate JWT token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({ message: 'Internal server error.' });
    }

    const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: '1h' });

    res.status(200).json({ token, message: 'Account verified. Please create your transaction PIN.' });
  } catch (error) {
    console.error('Failed to verify OTP:', error);
    return res.status(500).json({ message: 'An error occurred while verifying the OTP. Please try again later.' });
  }
};

export const resendOtp = async (req: Request, res: Response) => {
  const { email } = req.body;

  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase();
  const user = await userRepository.findOne({ where: { email: normalizedEmail } });

  // Check if user exists
  if (!user) {
    return res.status(400).json({ message: 'No account found associated with this email address.' });
  }

  // Check if user is already verified
  if (user.isVerified) {
    return res.status(400).json({ message: 'Your account is already verified. You can proceed to log in.' });
  }

  // Generate a new OTP and set expiry
  const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiry = new Date(Date.now() + OTP_EXPIRY_TIME);

  try {
    // Send new OTP email
    await sendOTPEmail(normalizedEmail, newOtp);

    // Update OTP and expiry in the user record
    user.otp = newOtp;
    user.otpExpiry = otpExpiry;
    await userRepository.save(user);

    res.status(200).json({ message: 'A new OTP has been sent to your email. Please check and verify.' });
  } catch (error) {
    console.error('Failed to send new OTP:', error);
    return res.status(500).json({ message: 'An error occurred while sending the new OTP. Please try again later.' });
  }
};

export const createTransactionPin = async (req: Request, res: Response) => {
  console.log("Create PIN route hit");
  const { pin } = req.body;

  if (!pin || pin.length !== 4) {
    return res.status(400).json({ message: 'PIN must be a 4-digit number.' });
  }

  const userRepository = AppDataSource.getRepository(User);
  const user = await userRepository.findOne({ where: { id: req.user?.userId } });

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const hashedPin = await bcrypt.hash(pin, 10);
  user.transactionPin = hashedPin;
  await userRepository.save(user);

  // Create wallets after transaction PIN is created
  try {
    await payshigaService.createWallet(user.id, 'NGN');
    await payshigaService.createWallet(user.id, 'USD');
    await payshigaService.createWallet(user.id, 'GBP');

    return res.status(200).json({ message: 'Transaction PIN created and wallets set up successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Error creating wallets. Please try again later.' });
  }
};



export const loginUser = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const userRepository = AppDataSource.getRepository(User);
  const normalizedEmail = email.toLowerCase();
  const user = await userRepository.findOne({ where: { email: normalizedEmail } });

  // Check if user exists and if password is correct
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(400).json({ message: 'Invalid credentials. Please check your email and password and try again.' });
  }

  // Check if user is verified
  if (!user.isVerified) {
    return res.status(400).json({ message: 'Your account is not verified. Please verify your account to log in.' });
  }

  // Generate JWT token
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ message: 'Internal server error: JWT_SECRET is not defined in environment variables.' });
  }

  const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: '1h' });

  res.status(200).json({ token, message: 'Login successful. Welcome back!' });
};
