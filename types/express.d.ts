import { JwtPayload } from 'jsonwebtoken';

declare module 'express' {
  interface Request {
    user?: JwtPayload & { id: string, email: string }; // Define custom payload with id and email
  }
}
