import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload, TokenExpiredError } from 'jsonwebtoken';

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
        const decoded = jwt.verify(token, jwtSecret) as JwtPayload & { id: string, email: string };
        console.log('Decoded token for user:', decoded.email);
        req.user = { id: decoded.id, email: decoded.email }; // Populate req.user
        next();
    } catch (error) {
        if (error instanceof TokenExpiredError) {
            console.error('Token expired:', error);
            return res.status(401).json({ message: 'Token has expired. Please log in again.' });
        }
        console.error('Invalid token:', error);
        return res.status(401).json({ message: 'Invalid token' });
    }
};
