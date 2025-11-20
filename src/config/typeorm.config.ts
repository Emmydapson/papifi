import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from '../entities/User';
import { Wallet } from '../entities/Wallet';
import { Profile } from '../entities/profile';
import { VirtualCard } from '../entities/virtualCard';
import { Transaction } from '../entities/Transaction';
import { KycVerification } from '../entities/KycVerification';
import path from 'path';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [User, Wallet, Profile, VirtualCard, Transaction, KycVerification],
  migrations: [path.join(__dirname, '../migrations/*.{ts,js}')],
  synchronize: false,
  logging: true,
});
