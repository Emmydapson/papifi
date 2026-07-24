import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';
import { isMapleradProviderError, mapleradErrorToHttpStatus } from '../services/mapleradService';

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({ message: 'Route not found' });
};

export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);

  if (isMapleradProviderError(err)) {
    logger.warn('maplerad_provider_error_response', {
      requestId: (req as any).id,
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.id,
      operation: err.operation,
      providerStatus: err.providerStatus,
      providerMessage: err.providerMessage,
      providerRequestId: err.requestId,
      code: err.code,
    });
    return res.status(mapleradErrorToHttpStatus(err)).json({
      message: 'Unable to verify BVN with Maplerad.',
      code: err.code,
      providerStatus: err.providerStatus,
      providerMessage: err.providerMessage || 'Maplerad could not complete the request.',
      requestId: err.requestId || (req as any).id,
    });
  }

  logger.error('unhandled_request_error', err, {
    requestId: (req as any).id,
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id,
  });
  return res.status(500).json({ message: 'Internal server error' });
};
