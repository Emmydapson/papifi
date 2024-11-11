// src/utils/countryUtils.ts
export const parseCountryFromPhoneNumber = (phoneNumber: string): string | null => {
    // Dummy function - replace this with actual country code mapping logic
    const countryCode = phoneNumber.slice(0, 4); // Adjust as per actual phone number format
    switch (countryCode) {
      case '+234': return 'Nigeria';
      case '+44': return 'United Kingdom';
      // Add more country codes as needed
      default: return null;
    }
  };