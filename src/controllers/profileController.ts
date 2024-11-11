// src/controllers/profileController.ts
import { Request, Response } from 'express';
import { getProfile, updateProfile } from '../services/profileService';
import { JwtPayload } from 'jsonwebtoken';
import { updatePassword } from '../services/profileService';
import { createSupportTicket } from '../services/zendeskService';
import { parseCountryFromPhoneNumber } from '../utils/countryUtils';

export const getUserProfile = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  const userId = (typeof req.user === 'string') ? req.user : (req.user as JwtPayload).id;

  if (!userId) {
    return res.status(400).json({ message: 'User ID not found in token' });
  }

  try {
    const profile = await getProfile(userId);

    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    // Extract profile fields for response
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

    // Infer country from the phone number's country code
    const country = phoneNumber ? parseCountryFromPhoneNumber(phoneNumber) : null;

    res.status(200).json({
      firstName,
      lastName,
      email,
      gender,
      phoneNumber: phoneNumber || null,
      country,
      nationality: nationality || null,
      dateOfBirth: dateOfBirth || null,
      address: address || null,
    });
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
};

export const updateUserProfile = async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  const userId = (typeof req.user === 'string') ? req.user : (req.user as JwtPayload).id;

  if (!userId) {
    return res.status(400).json({ message: 'User ID not found in token' });
  }

  const { address, phoneNumber, nationality, dateOfBirth } = req.body;

  // Disallow updating 'firstName', 'lastName', and 'email'
  if (req.body.firstName || req.body.lastName || req.body.email) {
    return res.status(400).json({ message: 'Cannot update firstName, lastName, or email' });
  }

  // Prepare update object
  const updateFields: Partial<{
    address: string;
    phoneNumber: string;
    nationality: string;
    dateOfBirth: string;
  }> = {};

  if (address) updateFields.address = address;
  if (phoneNumber) updateFields.phoneNumber = phoneNumber;
  if (nationality) updateFields.nationality = nationality;
  if (dateOfBirth) updateFields.dateOfBirth = dateOfBirth;

  try {
    const updatedProfile = await updateProfile(userId, updateFields);
    res.status(200).json(updatedProfile);
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
};


export const changePassword = async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ message: 'User not authenticated' });
    }
  
    const userId = (typeof req.user === 'string') ? req.user : (req.user as JwtPayload).id;
    const { currentPassword, newPassword } = req.body;
  
    if (!userId) {
      return res.status(400).json({ message: 'User ID not found in token' });
    }
  
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Both current and new password are required' });
    }
  
    try {
      // Call the service to update the password
      const isPasswordUpdated = await updatePassword(userId, currentPassword, newPassword);
  
      if (!isPasswordUpdated) {
        return res.status(400).json({ message: 'Invalid current password' });
      }
  
      res.status(200).json({ message: 'Password updated and notification sent successfully' });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  };

  export const submitSupportRequest = async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ message: 'User not authenticated' });
    }
  
    const { subject, description } = req.body;
    const userEmail = req.user.email; // Now this is safe because email exists on JwtPayload
  
    if (!subject || !description) {
      return res.status(400).json({ message: 'Subject and description are required' });
    }
  
    try {
      const ticket = await createSupportTicket(userEmail, subject, description);
      res.status(201).json({ message: 'Support request submitted successfully', ticket });
    } catch (error) {
      res.status(500).json({ message: (error as Error).message });
    }
  };
  