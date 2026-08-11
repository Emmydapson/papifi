import { AppDataSource } from '../database';
import { Profile } from '../entities/profile';
import { User } from '../entities/User';
import bcrypt from 'bcryptjs';
import { sendPasswordChangeNotification } from '../services/emailNotification';

const normalizeOptionalString = (value: unknown, field: string, maxLength = 120) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw new Error(`${field} is too long`);
  return trimmed;
};

const normalizeCountry = (value: unknown) => {
  const normalized = normalizeOptionalString(value, 'country', 2);
  if (normalized === undefined || normalized === null) return normalized;
  const country = normalized.toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('country must be an ISO 3166-1 alpha-2 code');
  return country;
};

const normalizePostalCode = (value: unknown) => {
  const normalized = normalizeOptionalString(value, 'postalCode', 20);
  if (normalized === undefined || normalized === null) return normalized;
  if (!/^[A-Za-z0-9 -]{3,20}$/.test(normalized)) throw new Error('postalCode contains invalid characters');
  return normalized;
};

const normalizeDateOfBirth = (value: unknown) => {
  const normalized = normalizeOptionalString(value, 'dateOfBirth', 10);
  if (normalized === undefined || normalized === null) return normalized;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('dateOfBirth must use YYYY-MM-DD');
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error('dateOfBirth must be a valid date');
  return normalized;
};

const normalizeProfileUpdate = (profileData: Partial<Profile>): Record<string, string | null | undefined> => {
  const allowed = new Set([
    'address',
    'city',
    'state',
    'postalCode',
    'phoneNumber',
    'country',
    'dateOfBirth',
    'nationality',
  ]);
  for (const key of Object.keys(profileData)) {
    if (!allowed.has(key)) throw new Error(`Cannot update ${key}`);
  }
  return {
    address: normalizeOptionalString(profileData.address, 'address'),
    city: normalizeOptionalString(profileData.city, 'city', 80),
    state: normalizeOptionalString(profileData.state, 'state', 80),
    postalCode: normalizePostalCode(profileData.postalCode),
    phoneNumber: normalizeOptionalString(profileData.phoneNumber, 'phoneNumber', 20),
    country: normalizeCountry(profileData.country),
    dateOfBirth: normalizeDateOfBirth(profileData.dateOfBirth),
    nationality: normalizeCountry(profileData.nationality),
  };
};

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
  Object.assign(profile, normalizeProfileUpdate(profileData));

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
