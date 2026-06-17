import { randomUUID } from 'crypto';
import { sanitizeAuditMetadata } from './auditService';

type LogLevel = 'info' | 'warn' | 'error';

const safeError = (error: unknown) => {
  if (!(error instanceof Error)) return sanitizeAuditMetadata(error);
  return {
    name: error.name,
    message: error.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
  };
};

const write = (level: LogLevel, event: string, metadata?: Record<string, unknown>) => {
  const payload = sanitizeAuditMetadata({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...metadata,
  });
  const line = JSON.stringify(payload);
  if (level === 'error') return console.error(line);
  if (level === 'warn') return console.warn(line);
  return console.log(line);
};

export const logger = {
  childRequestId: () => randomUUID(),
  info: (event: string, metadata?: Record<string, unknown>) => write('info', event, metadata),
  warn: (event: string, metadata?: Record<string, unknown>) => write('warn', event, metadata),
  error: (event: string, error?: unknown, metadata?: Record<string, unknown>) =>
    write('error', event, { ...metadata, error: safeError(error) }),
};
