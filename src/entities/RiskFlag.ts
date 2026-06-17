import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type RiskFlagStatus = 'OPEN' | 'REVIEWED' | 'DISMISSED';
export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

@Index(['userId', 'createdAt'])
@Index(['transactionId'])
@Index(['status', 'createdAt'])
@Entity()
export class RiskFlag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @Column({ nullable: true })
  transactionId?: string;

  @Column()
  rule!: string;

  @Column({ type: 'varchar', default: 'MEDIUM' })
  severity!: RiskSeverity;

  @Column({ type: 'varchar', default: 'OPEN' })
  status!: RiskFlagStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt!: Date;
}
