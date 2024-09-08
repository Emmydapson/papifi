import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import jwt from 'jsonwebtoken';
import { sendOTPEmail } from '../services/emailNotification';
import { createWallet } from '../services/walletService';
import { SessionData } from 'express-session';

export const registerUser = async (req: Request, res: Response) => {
  const { email, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  const userRepository = AppDataSource.getRepository(User);

  const existingUser = await userRepository.findOne({ where: { email } });
  if (existingUser) {
    return res.status(400).json({ message: 'User already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = new User();
  user.email = email;
  user.password = hashedPassword;

  await userRepository.save(user);

  // Generate OTP and send it to the user's email
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await sendOTPEmail(email, otp);

  // Store OTP and userId in the session
  (req.session as SessionData).otp = otp;
(req.session as SessionData).userId = user.id;

  res.status(201).json({ message: 'User registered. OTP sent to your email.' });
};

export const verifyOtp = async (req: Request, res: Response) => {
  const { otp } = req.body;
  const { otp: actualOtp, userId } = req.session;

  if (!userId) {
    return res.status(400).json({ message: 'User ID is not found in session' });
  }

  if (otp === actualOtp) {
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.isVerified = true;
    await userRepository.save(user);

    // Ensure `userId` is defined before calling `createWallet`
    await createWallet(userId);

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({ message: 'JWT_SECRET is not defined in environment variables' });
    }

    const token = jwt.sign({ userId: user.id }, jwtSecret, {
      expiresIn: '1h',
    });

    res.status(200).json({ token, message: 'User verified and wallet created' });
  } else {
    res.status(400).json({ message: 'Invalid OTP' });
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

  const token = jwt.sign({ userId: user.id }, jwtSecret, {
    expiresIn: '1h',
  });

  res.status(200).json({ token, message: 'Login successful' });
};