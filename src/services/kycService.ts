import crypto from 'crypto';
import { KycType, KycVerification } from '../entities/KycVerification';
import { MapleradBvnVerificationResult } from './mapleradService';

export type NormalizedBvnInput =
  | { ok: true; value: string; masked: string; redacted: { last4: string; length: number } }
  | { ok: false; message: string };

export type KycStatusSummary = {
  id?: string;
  type: KycType;
  status: string;
  provider?: string;
  providerEnvironment?: string;
  providerRequestId?: string;
  bvn?: { last4?: string };
  issuedCountry?: string;
  expiresAt?: string;
  createdAt?: Date;
  verifiedAt?: Date;
  attemptCount: number;
};

export type KycAttemptOutcome =
  | 'VERIFIED'
  | 'INVALID_INPUT'
  | 'PROVIDER_REJECTED'
  | 'PROVIDER_UNAVAILABLE'
  | 'CONFIGURATION_ERROR'
  | 'INSUFFICIENT_PROVIDER_BALANCE';

const bvnTypes = new Set<KycType>(['BVN']);

export const normalizeBvnInput = (input: unknown): NormalizedBvnInput => {
  if (typeof input !== 'string') return { ok: false, message: 'BVN must be an 11-digit string.' };
  const value = input.trim();
  if (!/^\d{11}$/.test(value)) return { ok: false, message: 'A valid 11-digit BVN is required.' };
  return {
    ok: true,
    value,
    masked: `*******${value.slice(-4)}`,
    redacted: { last4: value.slice(-4), length: value.length },
  };
};

export const resolveBvnFingerprintSecret = () => {
  const secret = process.env.BVN_FINGERPRINT_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BVN_FINGERPRINT_SECRET must be at least 32 characters in production');
  }
  return 'development-only-bvn-fingerprint-secret';
};

export const bvnFingerprint = (normalizedBvn: string) =>
  crypto.createHmac('sha256', resolveBvnFingerprintSecret()).update(normalizedBvn).digest('hex');

export const bvnSuccessMetadata = (
  bvn: { last4: string; length: number },
  result: MapleradBvnVerificationResult,
) => ({
  provider: 'maplerad',
  providerEnvironment: result.providerEnvironment,
  providerStatus: result.providerStatus,
  providerHttpStatus: result.providerHttpStatus,
  providerRequestId: result.providerRequestId,
  bvn,
});

export const bvnFailureMetadata = (
  bvn: { last4: string; length: number },
  result: MapleradBvnVerificationResult,
) => ({
  provider: 'maplerad',
  providerEnvironment: result.providerEnvironment,
  providerStatus: result.providerStatus,
  providerHttpStatus: result.providerHttpStatus,
  providerRequestId: result.providerRequestId,
  providerMessage: result.providerMessage,
  bvn,
});

export const bvnProviderErrorMetadata = (
  bvn: { last4: string; length: number },
  input: {
    providerEnvironment?: string;
    providerHttpStatus?: number;
    providerRequestId?: string;
    providerErrorCode?: string;
    providerMessage?: string;
  },
) => ({
  provider: 'maplerad',
  providerEnvironment: input.providerEnvironment,
  providerHttpStatus: input.providerHttpStatus,
  providerRequestId: input.providerRequestId,
  providerErrorCode: input.providerErrorCode,
  providerMessage: input.providerMessage,
  bvn,
});

export const providerErrorAttemptOutcome = (code: string): KycAttemptOutcome => {
  if (code === 'MAPLERAD_INSUFFICIENT_BALANCE') return 'INSUFFICIENT_PROVIDER_BALANCE';
  if (code === 'MAPLERAD_AUTHENTICATION_FAILED' || code === 'MAPLERAD_CONFIGURATION_ERROR') return 'CONFIGURATION_ERROR';
  if (code === 'MAPLERAD_VALIDATION_ERROR') return 'PROVIDER_REJECTED';
  return 'PROVIDER_UNAVAILABLE';
};

const dateOrUndefined = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const serializeBvn = (verification: KycVerification, attemptCount: number): KycStatusSummary => {
  const metadata = verification.metadata || {};
  const summary: KycStatusSummary = {
    id: verification.id,
    type: verification.type,
    status: verification.status,
    provider: metadata.provider,
    providerEnvironment: metadata.providerEnvironment,
    providerRequestId: metadata.providerRequestId,
    createdAt: verification.createdAt,
    attemptCount,
  };
  if (metadata.bvn?.last4) summary.bvn = { last4: String(metadata.bvn.last4) };
  if (verification.status === 'PASSED') summary.verifiedAt = verification.createdAt;
  return summary;
};

const serializeDocument = (verification: KycVerification, attemptCount: number): KycStatusSummary => {
  const metadata = verification.metadata || {};
  return {
    id: verification.id,
    type: verification.type,
    status: verification.status,
    issuedCountry: metadata.issuedCountry,
    expiresAt: dateOrUndefined(metadata.expiresAt),
    createdAt: verification.createdAt,
    attemptCount,
  };
};

const currentVerificationForType = (verifications: KycVerification[]) => {
  if (verifications[0]?.type === 'BVN') {
    return verifications.find((verification) => verification.status === 'PASSED') || verifications[0];
  }
  return verifications[0];
};

export const serializeKycStatus = (userId: string, verifications: KycVerification[]) => {
  const grouped = new Map<KycType, KycVerification[]>();
  for (const verification of verifications) {
    const entries = grouped.get(verification.type) || [];
    entries.push(verification);
    grouped.set(verification.type, entries);
  }

  const summaries = Array.from(grouped.entries()).map(([type, entries]) => {
    const ordered = [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const current = currentVerificationForType(ordered);
    return bvnTypes.has(type) ? serializeBvn(current, ordered.length) : serializeDocument(current, ordered.length);
  });

  return {
    userId,
    verifications: summaries.sort((a, b) => String(a.type).localeCompare(String(b.type))),
  };
};
