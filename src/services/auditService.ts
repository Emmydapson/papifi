import { Request } from 'express';
import { AppDataSource } from '../database';
import { AuditLog } from '../entities/AuditLog';

const sensitiveKeys = [
  'password',
  'pin',
  'transactionPin',
  'otp',
  'token',
  'cvv',
  'cardNumber',
  'pan',
  'secret',
  'authorization',
  'apiKey',
  'accessKey',
  'privateKey',
  'publicKey',
  'signature',
  'headers',
  'providerPayload',
  'bvn',
];

export const sanitizeAuditMetadata = (value: any): any => {
  if (Array.isArray(value)) return value.map(sanitizeAuditMetadata);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive.toLowerCase()))
        ? '[redacted]'
        : sanitizeAuditMetadata(entry),
    ])
  );
};

export class AuditService {
  async log(input: {
    actorUserId?: string;
    targetUserId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: any;
    req?: Request;
  }) {
    const repo = AppDataSource.getRepository(AuditLog);
    const audit = repo.create({
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ipAddress: input.req?.ip,
      userAgent: input.req?.headers['user-agent'],
      metadata: sanitizeAuditMetadata(input.metadata),
    });
    return repo.save(audit);
  }
}

export const auditService = new AuditService();
