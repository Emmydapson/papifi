import { NextFunction, Request, Response } from 'express';
import { logger } from '../services/logger';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const requestId = String(req.headers['x-request-id'] || logger.childRequestId());
  (req as any).id = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    logger.info('http_request_completed', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.user?.id,
      ipAddress: req.ip,
    });
  });

  next();
};
