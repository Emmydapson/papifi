import express, { Request } from 'express';
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
import transactionRoutes from './routes/transactionRoutes';
import adminRoutes from './routes/adminRoutes';
import { corsMiddleware } from './middlewares/corsMiddleware';
import { errorHandler, notFoundHandler } from './middlewares/errorMiddleware';
import { requestLogger } from './middlewares/requestLogger';
import { validateEnv } from './config/env';
import { logger } from './services/logger';
import { startReconciliationWorker } from './workers/reconciliationWorker';
import { registerApiDocs } from './apiDocs';
import { mapleradStartupSummary } from './config/maplerad';



dotenv.config();
validateEnv();
logger.info('provider_configured', mapleradStartupSummary());

const app = express();
const PORT = Number(process.env.PORT) || 5000;

const trustProxy = process.env.MAPLERAD_TRUST_PROXY;
if (trustProxy === 'loopback') {
  app.set('trust proxy', 'loopback');
} else if (/^\d+$/.test(trustProxy || '')) {
  app.set('trust proxy', Number(trustProxy));
}

// PostgreSQL connection pool setup
const Pool = pg.Pool;
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`, // Ensure DATABASE_URL is in your .env file or use fallback credentials
});

// Configure session middleware using PostgreSQL
const PgSessionStore = pgSession(session);


app.use(corsMiddleware);
app.use(requestLogger);

app.use(
  express.json({
    verify: (req: Request & { rawBody?: Buffer }, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Initialize and use session middleware
app.use(
  session({
    store: new PgSessionStore({
      pool: pgPool, 
     tableName: 'session', 
    }),
    secret: process.env.SESSION_SECRET || 'development_session_secret',
    resave: false, 
    saveUninitialized: false, 
    cookie: {
      secure: process.env.NODE_ENV === 'production',
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
app.get('/ready', async (req, res) => {
  if (!AppDataSource.isInitialized) return res.status(503).json({ status: 'not_ready' });
  try {
    await AppDataSource.query('SELECT 1');
    const migrationsPending = await AppDataSource.showMigrations();
    if (migrationsPending) {
      return res.status(503).json({ status: 'schema_not_ready', migrationsPending: true });
    }
    return res.json({ status: 'ready' });
  } catch {
    return res.status(503).json({ status: 'not_ready' });
  }
});

registerApiDocs(app);

// Use routes after initializing session middleware
app.use('/api/auth', authRoutes);
app.use('/api', walletRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api', transactionRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);



// Initialize the data source and start the server
AppDataSource.initialize()
  .then(() => {
    startReconciliationWorker();
    app.listen(PORT, '0.0.0.0', () => {
      logger.info('server_started', { host: '0.0.0.0', port: PORT });
    });
  })
  .catch((err) => {
    logger.error('datasource_initialization_failed', err);
  });
