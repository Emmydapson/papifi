// kycData.ts
export interface KYCData {
  governmentId: {
    type: 'passport' | 'national_id' | 'voters_card' | 'drivers_license' | 'residential_card';
    frontImage: string; // URL or path to the front image of the government ID
    backImage: string; // URL or path to the back image of the government ID
  };
  citizenship: string; // The country the user is from
  selfie: string; // URL or path to the selfie for face recognition
}
