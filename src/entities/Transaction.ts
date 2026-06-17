import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './User';
import { Wallet } from './Wallet';

export type TransactionType = 'deposit' | 'withdrawal' | 'transfer';
export type TransactionStatus =
  | 'pending'
  | 'success'
  | 'failed'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REVERSED';
export type ReconciliationStatus = 'PENDING' | 'MATCHED' | 'MISMATCHED' | 'FAILED' | 'MANUAL_REVIEW';

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

  @Column({
    type: 'enum',
    enum: ['pending', 'success', 'failed', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED'],
    default: 'PENDING',
  })
  status!: TransactionStatus;

  @Index({ unique: true })
  @Column({ nullable: true })
  reference?: string;

  @Column({ nullable: true })
  description?: string;

  @Index({ unique: true })
  @Column({ nullable: true })
  idempotencyKey?: string;

  @Column({ nullable: true })
  provider?: string;

  @Index()
  @Column({ nullable: true })
  providerReference?: string;

  @Column({ nullable: true })
  providerStatus?: string;

  @Column({ type: 'jsonb', nullable: true })
  providerPayload?: any;

  @Column({ type: 'timestamp', nullable: true })
  settledAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  failedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  reversedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastCheckedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  reconciledAt?: Date;

  @Column({ type: 'varchar', default: 'PENDING' })
  reconciliationStatus!: ReconciliationStatus;

  @Column({ nullable: true })
  reconciliationNotes?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
