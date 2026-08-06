import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Currency } from './Wallet';
import { User } from './User';

export type WalletProvisioningState =
  | 'PENDING'
  | 'PROCESSING'
  | 'PROVISIONED'
  | 'RETRYING'
  | 'RECONCILIATION_REQUIRED'
  | 'FAILED';

@Index(['userId', 'provider', 'providerEnvironment', 'currency'], { unique: true })
@Index(['state', 'nextAttemptAt'])
@Entity('wallet_provisioning_job')
export class WalletProvisioningJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  user!: User;

  @Column()
  userId!: string;

  @Column()
  provider!: string;

  @Column()
  providerEnvironment!: 'sandbox' | 'production';

  @Column({ type: 'enum', enum: ['NGN', 'USD', 'GBP'], default: 'NGN' })
  currency!: Currency;

  @Column({ type: 'varchar', default: 'PENDING' })
  state!: WalletProvisioningState;

  @Column({ type: 'varchar', nullable: true })
  safeReasonCode?: string | null;

  @Column({ type: 'int', default: 0 })
  retryCount!: number;

  @Column({ type: 'timestamp', nullable: true })
  nextAttemptAt?: Date | null;

  @Column({ type: 'varchar', nullable: true })
  lastProviderRequestId?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
