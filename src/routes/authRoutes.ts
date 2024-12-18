// src/routes/authRoutes.ts
import { Router } from 'express';
import {
  registerUser,
  resendOtp,
  verifyOtp,
  loginUser,
  createTransactionPin,
  requestPasswordReset, // New import
  resetPassword,  verifyOtpForPasswordReset,
  makeAdmin, removeAdmin       // New import
} from '../controllers/authController';
import {authMiddleware} from '../middlewares/authMiddleware';
import KYCController from '../controllers/kycControllers';

const router = Router();

router.post('/register', registerUser);
router.post('/verify-otp', verifyOtp);
router.post('/login', loginUser);
router.post('/resend-otp', resendOtp);
console.log('Resend OTP route hit');
router.post('/kyc/verify', KYCController.verifyKYC);
router.post('/create-pin', createTransactionPin);
router.post('/make-admin', authMiddleware, makeAdmin); // Requires token
router.post('/remove-admin', authMiddleware, removeAdmin);


// New forgot password routes
router.post('/forgot-password', requestPasswordReset); // Initiates password reset
router.post('/reset-password', resetPassword);         // Completes password reset
router.post('/reset-passwordOtp', verifyOtpForPasswordReset)

export default router;
