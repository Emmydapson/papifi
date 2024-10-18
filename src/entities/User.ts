import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Wallet } from './Wallet';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ unique: false })
  gender!: string;

  @Column({ name: 'fullname', nullable: false }) // Updated here
  fullName!: string;

  @Column({ nullable: true })
  transactionPin?: string; 

  @Column()
  password!: string;

  @Column({ nullable: true })
  googleId?: string;

  @Column({ nullable: true })
  appleId?: string;

  @Column({ type: 'varchar', nullable: true }) // Nullable because it will only be used temporarily
  otp?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  otpExpiry: Date | null;

  @Column({ nullable: true })
  phoneNumber?: string;

  @Column({ default: false })
  isVerified!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  // Add a one-to-many relation to wallets
  @OneToMany(() => Wallet, (wallet) => wallet.user)
  wallets!: Wallet[];  // A user can have multiple wallets

  @Column({ default: false })
  isKYCVerified!: boolean;
}
