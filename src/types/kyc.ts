
export interface UserKYCData {
    firstName: string;
    lastName: string;
    dateOfBirth: string;  // Format: YYYY-MM-DD
    idType: string;  // e.g., 'passport', 'driver_license'
    idNumber: string;
    address: string;
    country: string;
  }
  
  export interface KYCResponse {
    status: string;  // e.g., 'success', 'failed'
    message: string;
    verificationId: string;
    verificationStatus: string;  // e.g., 'approved', 'pending', 'rejected'
  }