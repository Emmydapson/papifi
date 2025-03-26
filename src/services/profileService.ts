import { AppDataSource } from '../database';
import { Profile } from '../entities/profile';
import { User } from '../entities/User';
import bcrypt from 'bcryptjs';
import { sendPasswordChangeNotification } from '../services/emailNotification';

// Get the user profile by userId
export const getProfile = async (userId: string): Promise<Profile> => {
  const profileRepository = AppDataSource.getRepository(Profile);
  const userRepository = AppDataSource.getRepository(User);

  // First, try to fetch the profile
  let profile = await profileRepository.findOne({ where: { user: { id: userId } } });

  // If no profile exists, get the user data and create a temporary profile
  if (!profile) {
    const user = await userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    // Create a temporary profile using user data
    profile = new Profile();
    profile.firstName = user.firstName;
    profile.lastName = user.lastName;
    profile.email = user.email;
    profile.phoneNumber = user.phoneNumber;
    profile.gender = user.gender;

    // Save the profile as temporary
    profile.user = user; // Link profile to the user
    await profileRepository.save(profile);
  }

  return profile;
};


// Update the user profile
export const updateProfile = async (
  userId: string,
  profileData: Partial<Profile>
): Promise<Profile> => {
  const profileRepository = AppDataSource.getRepository(Profile);

  // Find the profile linked to the user
  const profile = await profileRepository.findOne({ where: { user: { id: userId } } });
  if (!profile) {
    throw new Error('Profile not found');
  }

  // Prevent updates to restricted fields
  if ('email' in profileData || 'firstName' in profileData || 'lastName' in profileData) {
    throw new Error('Cannot update email, firstName, or lastName');
  }

  // Merge provided fields into the existing profile
  Object.assign(profile, profileData);

  // Save the updated profile
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
