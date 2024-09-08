// src/routes/authRoutes.ts
import { Router } from 'express';
import { registerUser,  verifyOtp, loginUser } from '../controllers/authController';

const router = Router();

router.post('/register', registerUser);  // New route
router.post('/verify-otp', verifyOtp);
router.post('/login', loginUser);

export default router;
