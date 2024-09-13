import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import jwt from 'jsonwebtoken';
import { sendOTPEmail } from '../services/emailNotification';
import { createWallet } from '../services/walletService';

export const registerUser = async (req: Request, res: Response) => {
  console.log(req.session);
  const { email, password, confirmPassword } = req.body;

  // Check if passwords match
  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  const userRepository = AppDataSource.getRepository(User);
  const existingUser = await userRepository.findOne({ where: { email } });

  // Check if user already exists
  if (existingUser) {
    return res.status(400).json({ message: 'User already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  // Generate OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    // Try sending the OTP email
    await sendOTPEmail(email, otp);

    // Store OTP and temporary user details in session
    req.session.otp = otp;
    req.session.email = email;
    req.session.hashedPassword = hashedPassword;

    console.log('OTP sent successfully, user details stored in session');
    res.status(200).json({ message: 'OTP sent to your email. Please verify to complete registration.' });

  } catch (error) {
    // If OTP email fails, return an error response
    console.error('Failed to send OTP:', error);
    return res.status(500).json({ message: 'Failed to send OTP email' });
  }
};


export const verifyOtp = async (req: Request, res: Response) => {
  const { otp } = req.body;
  const { otp: actualOtp, email, hashedPassword } = req.session;

  if (!email || !hashedPassword) {
    return res.status(400).json({ message: 'No registration data found in session' });
  }

  if (otp === actualOtp) {
    const userRepository = AppDataSource.getRepository(User);
    
    // Check if user already exists just in case
    const existingUser = await userRepository.findOne({ where: { email } });
    if (existingUser) {
      if (!existingUser.isVerified) {
        return res.status(400).json({ message: 'User already exists but is not verified. Please resend OTP.' });
      }
      return res.status(400).json({ message: 'User already exists' });
    }
    
    // Save the user after OTP verification
    const user = new User();
    user.email = email;
    user.password = hashedPassword; // hashed password from session
    user.isVerified = true;

    await userRepository.save(user);

    // Create a wallet for the user
    await createWallet(user.id);

    // Generate JWT token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({ message: 'JWT_SECRET is not defined in environment variables' });
    }

    const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: '1h' });

    // Clear session data after successful registration
    req.session.otp = null;
    req.session.email = null;
    req.session.hashedPassword = null;

    res.status(200).json({ token, message: 'User verified and wallet created' });

  } else {
    res.status(400).json({ message: 'Invalid OTP' });
  }
};

// Resend OTP function
export const resendOtp = async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  const userRepository = AppDataSource.getRepository(User);
  const existingUser = await userRepository.findOne({ where: { email } });

  // Check if the user exists but is not verified
  if (!existingUser) {
    return res.status(400).json({ message: 'User does not exist' });
  }

  if (existingUser.isVerified) {
    return res.status(400).json({ message: 'User is already verified' });
  }

  // Generate a new OTP
  const newOtp = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    // Try sending the new OTP email
    await sendOTPEmail(email, newOtp);

    // Store the new OTP in session
    req.session.otp = newOtp;
    req.session.email = email;

    console.log('New OTP sent successfully to', email);
    res.status(200).json({ message: 'New OTP sent to your email. Please verify to complete registration.' });
  } catch (error) {
    console.error('Failed to send new OTP:', error);
    return res.status(500).json({ message: 'Failed to send OTP email' });
  }
};

export const loginUser = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const userRepository = AppDataSource.getRepository(User);
  const user = await userRepository.findOne({ where: { email } });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(400).json({ message: 'Invalid credentials' });
  }

  if (!user.isVerified) {
    return res.status(400).json({ message: 'User not verified' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ message: 'JWT_SECRET is not defined in environment variables' });
  }

  const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: '1h' });

  res.status(200).json({ token, message: 'Login successful' });
};
