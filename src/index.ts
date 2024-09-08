import express from 'express';
import session from 'express-session'; // Import express-session
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import { AppDataSource } from './database';
import walletRoutes from './routes/walletRoutes'; 

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Use JSON middleware
app.use(express.json());

// Initialize and use session middleware
app.use(
  session({
    secret: 'your_secret_key', // Replace with your secret key
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true if using HTTPS in production
  })
);

// Use routes after initializing session middleware
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);

AppDataSource.initialize()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Error during Data Source initialization:', err);
  });
