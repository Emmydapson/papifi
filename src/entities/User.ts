import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  BeforeInsert,
} from 'typeorm';
import { Wallet } from './Wallet';
import { KycVerification } from './KycVerification';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  firstName!: string;

  @Column()
  lastName!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ unique: true })
  phoneNumber!: string;

  @Column({ unique: false })
  gender!: string;

  @Column({ nullable: true })
  transactionPin?: string;

  @Column()
  password!: string;

  @Column({ nullable: true })
  googleId?: string;

  @Column({ nullable: true })
  appleId?: string;

  @Column({ type: 'varchar', nullable: true })
  otp?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  otpExpiry: Date | null;

  @Column({ default: false })
  isVerified!: boolean;

  /** 🟢 Maplerad Customer ID (used for account/virtual card/transfer operations) */
  @Column({ nullable: true })
  mapleradCustomerId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => Wallet, (wallet) => wallet.user)
  wallets!: Wallet[];

  @Column({ default: false })
  isKYCVerified!: boolean;

  

  @Column({
    type: 'enum',
    enum: ['user', 'admin', 'super_admin'],
    default: 'user',
  })
  role!: 'user' | 'admin' | 'super_admin';

  @OneToMany(() => KycVerification, (kyc) => kyc.user)
  kycVerifications!: KycVerification[];

  @BeforeInsert()
  validatePhoneNumber() {
    const phonePattern = /^\+[1-9]\d{1,14}$/;
    if (!phonePattern.test(this.phoneNumber)) {
      throw new Error(
        'Phone number must include a valid country code (e.g., +123456789).'
      );
    }
  }
}
