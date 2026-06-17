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
import { authRateLimit, otpRateLimit, pinRateLimit } from '../middlewares/rateLimitMiddleware';

const router = Router();

router.post('/register', authRateLimit, registerUser);
router.post('/verify-otp', otpRateLimit, verifyOtp);
router.post('/login', authRateLimit, loginUser);
router.post('/resend-otp', otpRateLimit, resendOtp);
router.post('/create-pin', authMiddleware, pinRateLimit, createTransactionPin);
router.post('/make-admin', authMiddleware, makeAdmin); // Requires token
router.post('/remove-admin', authMiddleware, removeAdmin);


// New forgot password routes
router.post('/forgot-password', otpRateLimit, requestPasswordReset); // Initiates password reset
router.post('/reset-password', otpRateLimit, resetPassword);         // Completes password reset
router.post('/reset-passwordOtp', otpRateLimit, verifyOtpForPasswordReset)

export default router;
