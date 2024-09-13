import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import walletRoutes from './routes/walletRoutes';
import profileRoutes from './routes/profileRoutes';
import { AppDataSource } from './database'; // Database connection
import pg from 'pg'; // PostgreSQL client
import pgSession from 'connect-pg-simple'; // PostgreSQL session store
import "reflect-metadata";


dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// PostgreSQL connection pool setup
const Pool = pg.Pool;
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`, // Ensure DATABASE_URL is in your .env file or use fallback credentials
});

// Configure session middleware using PostgreSQL
const PgSessionStore = pgSession(session);

// Use JSON middleware
app.use(express.json());

// Initialize and use session middleware
app.use(
  session({
    store: new PgSessionStore({
      pool: pgPool, // Connect to PostgreSQL pool
      tableName: 'session', // This is the default table name; change if needed
    }),
    secret: process.env.SESSION_SECRET || 'fallback_secret_key', // Use a secret key from .env
    resave: false, // Do not save sessions if they are not modified
    saveUninitialized: false, // Do not save uninitialized sessions
    cookie: {
      secure: process.env.NODE_ENV === 'production', // Set to true if using HTTPS
      maxAge: 1000 * 60 * 60 * 24, // Cookie expiration: 24 hours
      httpOnly: true, // For security; makes cookies inaccessible to JavaScript
    },
  })
);

// Use routes after initializing session middleware
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/profile', profileRoutes);

// Initialize the data source and start the server
AppDataSource.initialize()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Error during Data Source initialization:', err);
  });
