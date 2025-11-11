import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './User';

@Entity()
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, (user) => user.wallets, { eager: true })
  user!: User;

  /** 🟢 Maplerad Virtual Account Details */
  @Column({ nullable: true })
  mapleradAccountId?: string;

  @Column({ nullable: true })
  accountNumber?: string;

  @Column({ nullable: true })
  bankName?: string;

  /** 🪙 Default Currency */
 @Column({ type: 'enum', enum: ['NGN', 'USD', 'GBP'], default: 'NGN' })
currency!: 'NGN' | 'USD' | 'GBP';


  /** 💰 Balances */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  NGN!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  GBP!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  USD!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
balance!: number;


  
}
