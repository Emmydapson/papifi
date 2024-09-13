import 'express-session';

declare module 'express-session' {
  interface SessionData {
    otp: string | null;
    userId: string | null;
    email: string | null; // Make email nullable
    hashedPassword: string | null; // Make hashedPassword nullable
  }
}
