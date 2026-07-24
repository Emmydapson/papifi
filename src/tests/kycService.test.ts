import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { KycVerification } from '../entities/KycVerification';
import {
  bvnFingerprint,
  bvnSuccessMetadata,
  normalizeBvnInput,
  serializeKycStatus,
} from '../services/kycService';

const verification = (input: Partial<KycVerification>): KycVerification => ({
  id: input.id || crypto.randomUUID(),
  userId: input.userId || 'user-1',
  type: input.type || 'BVN',
  status: input.status || 'PENDING',
  confidence: input.confidence as any,
  metadata: input.metadata || {},
  bvnFingerprint: input.bvnFingerprint,
  attemptOutcome: input.attemptOutcome,
  createdAt: input.createdAt || new Date(),
  updatedAt: input.updatedAt || new Date(),
  user: input.user as any,
});

test('normalizeBvnInput rejects non-string, non-numeric, and non-11-digit values', () => {
  for (const input of [12345678901, '1234567890', '123456789012', '12345 78901', 'abcdefghijk']) {
    const result = normalizeBvnInput(input);
    assert.equal(result.ok, false);
  }

  const valid = normalizeBvnInput(' 12345677891 ');
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value, '12345677891');
    assert.deepEqual(valid.redacted, { last4: '7891', length: 11 });
    assert.equal(valid.masked, '*******7891');
  }
});

test('BVN fingerprint is keyed and stable without exposing the BVN', () => {
  process.env.BVN_FINGERPRINT_SECRET = 'test-bvn-fingerprint-secret-32chars';
  const first = bvnFingerprint('12345678901');
  const second = bvnFingerprint('12345678901');
  const different = bvnFingerprint('12345678902');

  assert.equal(first, second);
  assert.notEqual(first, different);
  assert.equal(first.includes('12345678901'), false);
});

test('success metadata stores safe provider audit fields only', () => {
  const metadata = bvnSuccessMetadata(
    { last4: '7891', length: 11 },
    {
      verified: true,
      provider: 'maplerad',
      providerEnvironment: 'sandbox',
      applicationCode: 'BVN_VERIFIED',
      providerHttpStatus: 200,
      providerStatus: true,
      providerRequestId: 'req-1',
      identity: {
        firstName: 'John',
        middleName: 'Victoria',
        lastName: 'Doe',
        dateOfBirth: '1994-01-10',
        phoneNumber: '08000000000',
        image: 'base64-image-data',
      },
      responseKeys: ['data', 'message', 'status'],
      dataKeys: ['dob', 'first_name', 'image', 'last_name', 'phone_number'],
    },
  );

  const serialized = JSON.stringify(metadata);
  assert.deepEqual(metadata.bvn, { last4: '7891', length: 11 });
  assert.doesNotMatch(serialized, /providerResponse/);
  assert.doesNotMatch(serialized, /base64-image-data/);
  assert.doesNotMatch(serialized, /John|Victoria|Doe|1994-01-10|08000000000/);
  assert.doesNotMatch(serialized, /responseKeys|dataKeys/);
});

test('serializeKycStatus removes raw BVN provider and document metadata', () => {
  const records = [
    verification({
      id: 'bvn-1',
      type: 'BVN',
      status: 'PASSED',
      createdAt: new Date('2026-07-24T14:08:41.417Z'),
      metadata: {
        provider: 'maplerad',
        providerEnvironment: 'sandbox',
        providerRequestId: 'req-1',
        bvn: { last4: '7891', length: 11 },
        providerResponse: {
          dob: '1994-01-10',
          image: 'base64-image-data',
          first_name: 'John',
          middle_name: 'Victoria',
          last_name: 'Doe',
          phone_number: '08000000000',
        },
        responseKeys: ['data'],
        dataKeys: ['first_name'],
      },
    }),
    verification({
      id: 'doc-1',
      type: 'INTERNATIONAL_PASSPORT',
      status: 'PENDING',
      metadata: {
        documentNumber: 'A12345678',
        frontImageUrl: 'https://example.com/front.jpg',
        backImageUrl: 'https://example.com/back.jpg',
        selfieImageUrl: 'https://example.com/selfie.jpg',
        issuedCountry: 'NG',
        expiresAt: '2030-12-31',
        note: 'internal note',
      },
    }),
  ];

  const response = serializeKycStatus('user-1', records);
  const serialized = JSON.stringify(response);

  assert.equal(response.verifications.length, 2);
  assert.doesNotMatch(serialized, /providerResponse|base64-image-data|John|Victoria|Doe|1994-01-10|08000000000/);
  assert.doesNotMatch(serialized, /A12345678|front\.jpg|back\.jpg|selfie\.jpg|internal note/);
  assert.doesNotMatch(serialized, /responseKeys|dataKeys|metadata/);
});

test('serializeKycStatus returns one current result per KYC type and does not downgrade PASSED BVN', () => {
  const records = [
    verification({
      id: 'bvn-failed-later',
      type: 'BVN',
      status: 'FAILED',
      createdAt: new Date('2026-07-25T00:00:00.000Z'),
      metadata: { provider: 'maplerad', bvn: { last4: '2222', length: 11 } },
    }),
    verification({
      id: 'bvn-passed-earlier',
      type: 'BVN',
      status: 'PASSED',
      createdAt: new Date('2026-07-24T00:00:00.000Z'),
      metadata: { provider: 'maplerad', providerEnvironment: 'sandbox', bvn: { last4: '7891', length: 11 } },
    }),
    verification({
      id: 'nin-1',
      type: 'NIN',
      status: 'PENDING',
      createdAt: new Date('2026-07-23T00:00:00.000Z'),
      metadata: { issuedCountry: 'NG' },
    }),
  ];

  const response = serializeKycStatus('user-1', records);
  const bvn = response.verifications.find((entry) => entry.type === 'BVN');

  assert.equal(response.verifications.length, 2);
  assert.equal(bvn?.id, 'bvn-passed-earlier');
  assert.equal(bvn?.status, 'PASSED');
  assert.equal(bvn?.attemptCount, 2);
});
