// src/routes/authRoutes.ts
import { Router } from 'express';
import {
  registerUser,
  resendOtp,
  verifyOtp,
  loginUser,
  createTransactionPin,
  requestPasswordReset, // New import
  resetPassword,        // New import
} from '../controllers/authController';
import KYCController from '../controllers/kycControllers';

const router = Router();

router.post('/register', registerUser);
router.post('/verify-otp', verifyOtp);
router.post('/login', loginUser);
router.post('/resend-otp', resendOtp);
console.log('Resend OTP route hit');
router.post('/kyc/verify', KYCController.verifyKYC);
router.post('/create-pin', createTransactionPin);

// New forgot password routes
router.post('/forgot-password', requestPasswordReset); // Initiates password reset
router.post('/reset-password', resetPassword);         // Completes password reset

export default router;
