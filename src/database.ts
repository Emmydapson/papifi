import 'dotenv/config'; // This will load the .env file
import { DataSource } from 'typeorm';
import { User } from './entities/User'; 
import { Wallet } from "./entities/Wallet";
import { Profile } from "./entities/profile";
import path from 'path';
import { VirtualCard } from './entities/virtualCard';
import { Transaction } from './entities/Transaction';
import { KycVerification } from './entities/KycVerification';
import { WebhookEvent } from './entities/WebhookEvent';
import { LedgerAccount } from './entities/LedgerAccount';
import { LedgerJournal } from './entities/LedgerJournal';
import { LedgerEntry } from './entities/LedgerEntry';
import { AuditLog } from './entities/AuditLog';
import { RiskFlag } from './entities/RiskFlag';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [User, Wallet, Profile, VirtualCard, Transaction, KycVerification, WebhookEvent, LedgerAccount, LedgerJournal, LedgerEntry, AuditLog, RiskFlag ],
  migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],  // Add migration path
  synchronize: false, // Set to false in production
  logging: process.env.NODE_ENV !== 'production',
  subscribers: [],
  migrationsTableName: "custom_migrations_table", // Optional, if you want to change the migrations table name
});
