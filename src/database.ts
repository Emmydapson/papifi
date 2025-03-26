import 'dotenv/config'; // This will load the .env file
import { DataSource } from 'typeorm';
import { User } from './entities/User'; 
import { Wallet } from "./entities/Wallet";
import { Profile } from "./entities/profile";
import path from 'path';
import { VirtualCard } from './entities/virtualCard';
import { Transaction } from './entities/Transaction';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [User, Wallet, Profile, VirtualCard, Transaction],
  migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],  // Add migration path
  synchronize: false, // Set to false in production
  logging: true,
  subscribers: [],
  migrationsTableName: "custom_migrations_table", // Optional, if you want to change the migrations table name
});

AppDataSource.initialize()
  .then(() => {
    console.log('Data Source has been initialized!');
  })
  .catch((err) => {
    console.error('Error during Data Source initialization:', err);
  });
