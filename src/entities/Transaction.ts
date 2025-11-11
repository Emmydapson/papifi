import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './User';
import { Wallet } from './Wallet';

export type TransactionType = 'deposit' | 'withdrawal' | 'transfer';
export type TransactionStatus = 'pending' | 'success' | 'failed';

@Entity()
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Wallet, { nullable: true })
  @JoinColumn({ name: 'senderWalletId' })
  senderWallet?: Wallet;

  @ManyToOne(() => Wallet, { nullable: true })
  @JoinColumn({ name: 'recipientWalletId' })
  recipientWallet?: Wallet;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount!: number;

  @Column({ type: 'enum', enum: ['USD', 'GBP', 'NGN'] })
  currency!: 'USD' | 'GBP' | 'NGN';

  @Column({ type: 'enum', enum: ['deposit', 'withdrawal', 'transfer'] })
  type!: TransactionType;

  @Column({ type: 'enum', enum: ['pending', 'success', 'failed'], default: 'pending' })
  status!: TransactionStatus;

  @Column({ nullable: true })
  reference?: string;

  @Column({ nullable: true })
  description?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
