import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../database';
import { User } from '../entities/User';

export const adminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.id) return res.status(401).json({ message: 'Authentication required' });
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: req.user.id } });
  if (!user || !['admin', 'super_admin'].includes(user.role)) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  return next();
};
