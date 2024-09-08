// src/services/profileService.ts
import { AppDataSource } from '../database';
import { Profile } from '../entities/profile';
import { User } from '../entities/User';
import bcrypt from 'bcryptjs';
import { sendPasswordChangeNotification } from '../services/emailNotification';


export const createProfile = async (userId: string, profileData: Partial<Profile>) => {
  const profileRepository = AppDataSource.getRepository(Profile);
  const userRepository = AppDataSource.getRepository(User);

  const user = await userRepository.findOne({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  const profile = profileRepository.create({
    user,
    ...profileData,
  });

  await profileRepository.save(profile);

  return profile;
};

export const updateProfile = async (userId: string, profileData: Partial<Profile>) => {
  const profileRepository = AppDataSource.getRepository(Profile);

  const profile = await profileRepository.findOne({ where: { user: { id: userId } } });

  if (!profile) {
    throw new Error('Profile not found');
  }

  Object.assign(profile, profileData);

  await profileRepository.save(profile);

  return profile;
};

export const getProfile = async (userId: string) => {
  const profileRepository = AppDataSource.getRepository(Profile);

  const profile = await profileRepository.findOne({ where: { user: { id: userId } } });
  
  if (!profile) {
    throw new Error('Profile not found');
  }

  return profile;
};

export const updatePassword = async (userId: string, currentPassword: string, newPassword: string) => {
    const userRepository = AppDataSource.getRepository(User);
    
    const user = await userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }
  
    // Check if the current password is correct
    const isPasswordMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordMatch) {
      return false; // Invalid current password
    }
  
    // Hash the new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
  
    // Update the user's password
    user.password = hashedNewPassword;
    await userRepository.save(user);
  
    // Send email notification
  await sendPasswordChangeNotification(user.email);

    return true;
  };
