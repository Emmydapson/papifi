import 'dotenv/config'; // This will load the .env file
import { DataSource } from 'typeorm';
import { User } from './entities/User'; 
import { Wallet } from "./entities/Wallet";
import { Profile } from "./entities/profile"

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [User, Wallet, Profile],
  synchronize: false, // Set to false in production
  logging: true,
});

AppDataSource.initialize()
  .then(() => {
    console.log('Data Source has been initialized!');
  })
  .catch((err) => {
    console.error('Error during Data Source initialization:', err);
  });
