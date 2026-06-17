import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({ message: 'Route not found' });
};

export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);

  logger.error('unhandled_request_error', err, {
    requestId: (req as any).id,
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id,
  });
  return res.status(500).json({ message: 'Internal server error' });
};
