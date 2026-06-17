import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { User } from './User';

export type KycType =
  | 'BVN'
  | 'NIN'
  | 'DRIVERS_LICENSE'
  | 'INTERNATIONAL_PASSPORT'
  | 'VOTERS_CARD';

export type KycStatus = 'PENDING' | 'PASSED' | 'FAILED';

@Entity('kyc_verifications')
export class KycVerification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'varchar' })
  type: KycType;

  @Column({ type: 'varchar', default: 'PENDING' })
  status: KycStatus;

  @Column({ type: 'float', nullable: true })
  confidence: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.kycVerifications, { onDelete: 'CASCADE' })
  user!: User;

}
