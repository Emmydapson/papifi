import { AppDataSource } from '../database';
import { Profile } from '../entities/profile';
import { User } from '../entities/User';
import bcrypt from 'bcryptjs';
import { sendPasswordChangeNotification } from '../services/emailNotification';

// Get the user profile by userId
export const getProfile = async (userId: string) => {
  const profileRepository = AppDataSource.getRepository(Profile);

  // Find the profile associated with the userId
  const profile = await profileRepository.findOne({ where: { user: { id: userId } } });

  if (!profile) {
    throw new Error('Profile not found');
  }

  return profile;
};

// Update the user profile
export const updateProfile = async (userId: string, profileData: Partial<Profile>) => {
  const profileRepository = AppDataSource.getRepository(Profile);

  // Fetch the profile associated with the userId
  const profile = await profileRepository.findOne({ where: { user: { id: userId } } });

  if (!profile) {
    throw new Error('Profile not found');
  }

  // Prevent updates to email, firstName, and lastName (these should not be changed)
  if (profileData.email || profileData.firstName || profileData.lastName) {
    throw new Error('Cannot update email, firstName, or lastName');
  }

  // Update the profile with any provided profileData for mutable fields
  Object.assign(profile, profileData);

  // Save the updated profile
  await profileRepository.save(profile);

  return profile;
};

// Update user password
export const updatePassword = async (userId: string, currentPassword: string, newPassword: string) => {
  const userRepository = AppDataSource.getRepository(User);
  
  // Fetch the user based on userId
  const user = await userRepository.findOne({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  // Check if the current password matches
  const isPasswordMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isPasswordMatch) {
    return false; // Invalid current password
  }

  // Hash the new password
  const hashedNewPassword = await bcrypt.hash(newPassword, 10);

  // Update the user's password and save it
  user.password = hashedNewPassword;
  await userRepository.save(user);

  // Send an email notification to the user
  await sendPasswordChangeNotification(user.email);

  return true;
};
