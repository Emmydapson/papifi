// src/services/DojahService.ts
import axios from 'axios';

const DOJAH_BASE_URL =
  process.env.DOJAH_BASE_URL || 'https://sandbox.dojah.io/';
const APP_ID = process.env.DOJAH_APP_ID!;
const SECRET_KEY = process.env.DOJAH_SECRET_KEY!;

class DojahService {
  private headers = {
    AppId: APP_ID,
    Authorization: SECRET_KEY,
    'Content-Type': 'application/json',
  };

  /**
   * Example: verify photo ID against selfie
   */
  async verifyPhotoIdWithSelfie(selfie: string, photoId: string) {
    return axios.post(
      `${DOJAH_BASE_URL}/api/v1/kyc/photoid/verify`,
      { selfie_image: selfie, photoid_image: photoId },
      { headers: this.headers },
    );
  }

  /**
   * Example: subscribe webhook programmatically
   */
  async subscribeWebhook(webhookUrl: string, service = 'kyc_widget') {
    return axios.post(
      `${DOJAH_BASE_URL}/api/v1/webhook/subscribe`,
      { webhook: webhookUrl, service },
      { headers: this.headers },
    );
  }
}

export default new DojahService();
