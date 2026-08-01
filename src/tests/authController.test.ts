import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../database';
import { verifyOtp } from '../controllers/authController';

test('verifyOtp returns userId with token for fresh registration flow', async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  const otp = '123456';
  const user: any = {
    id: 'user-otp-1',
    email: 'ada@example.com',
    otp: await bcrypt.hash(otp, 4),
    otpExpiry: new Date(Date.now() + 60_000),
    otpPurpose: 'account_verification',
    isVerified: false,
  };
  const originalGetRepository = AppDataSource.getRepository.bind(AppDataSource);
  (AppDataSource as any).getRepository = () => ({
    findOne: async () => user,
    save: async (value: any) => value,
  });

  const response: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  };

  try {
    await verifyOtp({ body: { email: 'ADA@example.com', otp }, id: 'req-auth-test' } as any, response as any);
  } finally {
    (AppDataSource as any).getRepository = originalGetRepository;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.userId, user.id);
  assert.equal(typeof response.body.token, 'string');
});
