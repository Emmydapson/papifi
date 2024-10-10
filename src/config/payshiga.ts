import dotenv from 'dotenv';
dotenv.config();

const payshigaConfig = {
  baseUrl: process.env.PAYSHIGA_BASE_URL || 'https://sandbox.payshiga.com',
  apiKey: process.env.PAYSHIGA_API_KEY,
  secretKey: process.env.PAYSHIGA_SECRET_KEY,
};

export default payshigaConfig;
