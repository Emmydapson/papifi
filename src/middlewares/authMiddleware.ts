import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ message: 'JWT_SECRET is not defined in environment variables' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as JwtPayload & { id: string, email: string }; // Ensure id is included in the decoded payload
    console.log('Decoded token:', decoded);
    req.user = { id: decoded.id, email: decoded.email }; // Store id and email in req.user
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};
