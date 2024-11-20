import { Request, Response } from 'express';
import { getProfile, updateProfile, updatePassword } from '../services/profileService';
import { JwtPayload } from 'jsonwebtoken';

export const getUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;  // Get user ID from decoded token
    const profile = await getProfile(userId);  // Get profile from service

    // Destructure profile data
    const {
      firstName,
      lastName,
      email,
      gender,
      phoneNumber,
      nationality,
      dateOfBirth,
      address,
    } = profile;

    // Respond with the necessary fields, set optional fields to null if not provided
    res.status(200).json({
      firstName,
      lastName,
      email,
      gender,
      phoneNumber: phoneNumber || null,
      nationality: nationality || null,
      dateOfBirth: dateOfBirth || null,
      address: address || null,
    });
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
};

export const updateUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;
    const updateFields = req.body;

    const updatedProfile = await updateProfile(userId, updateFields);
    res.status(200).json(updatedProfile);
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id as string;
    const { currentPassword, newPassword } = req.body;

    const isUpdated = await updatePassword(userId, currentPassword, newPassword);
    if (!isUpdated) {
      return res.status(400).json({ message: 'Invalid current password' });
    }

    res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
};
