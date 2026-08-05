import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Index(['userId', 'providerEnvironment', 'reason'], { unique: true })
@Entity('maplerad_customer_recovery_attempt')
export class MapleradCustomerRecoveryAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @Column()
  providerEnvironment!: 'sandbox' | 'production';

  @Column()
  result!: string;

  @Column()
  reason!: string;

  @Column({ type: 'timestamp' })
  attemptedAt!: Date;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
