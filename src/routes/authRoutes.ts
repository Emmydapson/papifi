// src/routes/authRoutes.ts
import { Router } from 'express';
import { registerUser, resendOtp, verifyOtp, loginUser, createTransactionPin } from '../controllers/authController';
import KYCController from '../controllers/kycControllers';
import { authMiddleware } from '../middlewares/authMiddleware';


const router = Router();

router.post('/register', registerUser);  // New route
router.post('/verify-otp', authMiddleware, verifyOtp);
router.post('/login', loginUser);
router.post('/resend-otp', resendOtp);
console.log('Resend OTP route hit');
router.post('/kyc/verify', KYCController.verifyKYC)
router.post('/create-pin',  createTransactionPin);

export default router;
