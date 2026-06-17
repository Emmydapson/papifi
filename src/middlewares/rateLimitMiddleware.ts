import { Request, Response, NextFunction } from 'express';

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
};

const buckets = new Map<string, { count: number; resetAt: number }>();

export const createRateLimiter =
  ({ windowMs, max, keyPrefix }: RateLimitOptions) =>
  (req: Request, res: Response, next: NextFunction) => {
    const identity = req.user?.id || req.ip || 'unknown';
    const key = `${keyPrefix}:${identity}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (bucket.count >= max) {
      return res.status(429).json({ message: 'Too many requests. Please try again later.' });
    }

    bucket.count += 1;
    return next();
  };

export const authRateLimit = createRateLimiter({
  keyPrefix: 'auth',
  windowMs: 15 * 60 * 1000,
  max: 8,
});

export const otpRateLimit = createRateLimiter({
  keyPrefix: 'otp',
  windowMs: 15 * 60 * 1000,
  max: 5,
});

export const pinRateLimit = createRateLimiter({
  keyPrefix: 'pin',
  windowMs: 15 * 60 * 1000,
  max: 5,
});

export const moneyMovementRateLimit = createRateLimiter({
  keyPrefix: 'money',
  windowMs: 60 * 1000,
  max: 10,
});
