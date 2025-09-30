import axios from 'axios';

const DOJAH_BASE_URL = process.env.DOJAH_BASE_URL || 'https://sandbox.dojah.io/';
const APP_ID = process.env.DOJAH_APP_ID!;
const SECRET_KEY = process.env.DOJAH_SECRET_KEY!;

class DojahService {
  private headers = {
    'AppId': APP_ID,
    'Authorization': SECRET_KEY,
    'Content-Type': 'application/json',
  };

  async verifyPhotoIdWithSelfie(selfie: string, photoId: string) {
    const res = await axios.post(
      `${DOJAH_BASE_URL}/api/v1/kyc/photoid/verify`,
      { selfie_image: selfie, photoid_image: photoId },
      { headers: this.headers }
    );
    return res.data;
  }

  async verifyNinWithSelfie(nin: string, selfie: string) {
    const res = await axios.post(
      `${DOJAH_BASE_URL}/api/v1/kyc/nin/verify`,
      { nin, selfie_image: selfie },
      { headers: this.headers }
    );
    return res.data;
  }

  async livenessCheck(selfie: string) {
    const res = await axios.post(
      `${DOJAH_BASE_URL}/api/v1/ml/liveness/`,
      { image: selfie },
      { headers: this.headers }
    );
    return res.data;
  }
}

export default new DojahService();
