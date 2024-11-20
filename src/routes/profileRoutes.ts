// src/routes/profileRoutes.ts
import { Router } from 'express';
import {  getUserProfile, updateUserProfile } from '../controllers/profileController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { changePassword } from '../controllers/profileController';


const router = Router();


router.get('/', authMiddleware, getUserProfile);
router.put('/', authMiddleware, updateUserProfile);
router.put('/change-password', authMiddleware, changePassword);


export default router;
