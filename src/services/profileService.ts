import { AppDataSource } from '../database';
import { Profile } from '../entities/profile';
import { User } from '../entities/User';
import bcrypt from 'bcryptjs';
import { sendPasswordChangeNotification } from '../services/emailNotification';

// Get the user profile by userId
export const getProfile = async (userId: string): Promise<Profile> => {
  const profileRepository = AppDataSource.getRepository(Profile);

  const profile = await profileRepository.findOne({ where: { user: { id: userId } } });
  if (!profile) {
    throw new Error('Profile not found');
  }

  return profile;
};

// Update the user profile
export const updateProfile = async (
  userId: string,
  profileData: Partial<Profile>
): Promise<Profile> => {
  const profileRepository = AppDataSource.getRepository(Profile);

  const profile = await profileRepository.findOne({ where: { user: { id: userId } } });
  if (!profile) {
    throw new Error('Profile not found');
  }

  if (profileData.email || profileData.firstName || profileData.lastName) {
    throw new Error('Cannot update email, firstName, or lastName');
  }

  Object.assign(profile, profileData);
  return profileRepository.save(profile);
};

// Update user password
export const updatePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<boolean> => {
  const userRepository = AppDataSource.getRepository(User);

  const user = await userRepository.findOne({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  const isPasswordMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isPasswordMatch) {
    return false;
  }

  const hashedNewPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedNewPassword;
  await userRepository.save(user);

  await sendPasswordChangeNotification(user.email);
  return true;
};
