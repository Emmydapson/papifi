import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { User } from './User';

export type ProviderEnvironment = 'sandbox' | 'production';

@Index(['provider', 'providerEnvironment', 'providerCustomerId'], { unique: true })
@Index(['userId', 'provider', 'providerEnvironment', 'currency'], { unique: true })
@Index(['userId', 'provider', 'providerEnvironment', 'referenceType'], { unique: true })
@Index(['provider', 'providerEnvironment', 'referenceType', 'externalReference'], { unique: true })
@Entity('provider_reference')
export class ProviderReference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { nullable: false })
  user!: User;

  @Column()
  userId!: string;

  @Column()
  provider!: string;

  @Column()
  providerEnvironment!: ProviderEnvironment;

  @Column({ default: 'customer' })
  referenceType!: string;

  @Column({ nullable: true })
  externalReference?: string;

  @Column({ nullable: true })
  providerCustomerId?: string;

  @Column({ nullable: true })
  providerAccountId?: string;

  @Column({ nullable: true })
  accountNumber?: string;

  @Column({ nullable: true })
  bankName?: string;

  @Column({ nullable: true })
  currency?: string;

  @Column({ default: 'active' })
  status!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
