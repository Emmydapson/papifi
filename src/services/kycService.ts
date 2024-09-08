// src/services/kycService.ts
import axios from 'axios';
import { UserKYCData, KYCResponse } from '../types/kyc';

const KYC_API_URL = process.env.KYC_API_URL!;
const KYC_API_KEY = process.env.KYC_API_KEY!;

export const verifyUserKYC = async (userId: string, userData: UserKYCData): Promise<KYCResponse> => {
  try {
    const response = await axios.post<KYCResponse>(`${KYC_API_URL}/verify`, userData, {
      headers: {
        'Authorization': `Bearer ${KYC_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    // Handle response from KYC provider
    return response.data;
  } catch (error) {
    console.error('KYC verification failed:', error);
    throw new Error('KYC verification failed');
  }
};
