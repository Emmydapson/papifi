import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import walletRoutes from './routes/walletRoutes';
import profileRoutes from './routes/profileRoutes';
import { AppDataSource } from './database'; // Database connection
import pg from 'pg'; 
import pgSession from 'connect-pg-simple'; 
import "reflect-metadata";
import kycRoutes from './routes/kycRoutes';



dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;

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
      pool: pgPool, 
     tableName: 'session', 
    }),
    secret: process.env.SESSION_SECRET || 'fallback_secret_key', // Use a secret key from .env
    resave: false, 
    saveUninitialized: false, 
    cookie: {
      secure: process.env.NODE_ENV === 'development', // Set to true if using HTTPS
      maxAge: 1000 * 60 * 60 * 24,
      httpOnly: true, 
    },
  })
);

// Define a route for the root path
app.get('/', (req, res) => {
  res.send('Welcome to the API!'); // You can customize this message
});
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});


// Use routes after initializing session middleware
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/kyc', kycRoutes);



// Initialize the data source and start the server
AppDataSource.initialize()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
    
    
  })
  .catch((err) => {
    console.error('Error during Data Source initialization:', err);
  });
