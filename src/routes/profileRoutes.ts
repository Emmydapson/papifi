// src/routes/profileRoutes.ts
import { Router } from 'express';
import { createUserProfile, getUserProfile, updateUserProfile } from '../controllers/profileController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { changePassword } from '../controllers/profileController';
import { submitSupportRequest } from '../controllers/profileController';

const router = Router();

router.post('/profile', authMiddleware, createUserProfile);
router.get('/profile', authMiddleware, getUserProfile);
router.put('/profile', authMiddleware, updateUserProfile);
router.put('/change-password', authMiddleware, changePassword);
router.post('/support', authMiddleware, submitSupportRequest);

export default router;
