import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './User';
import { Wallet } from './Wallet';
import { Currency } from './Wallet';

export type LedgerAccountType =
  | 'USER_WALLET'
  | 'PROVIDER_SUSPENSE'
  | 'PROVIDER_SETTLEMENT'
  | 'FEES'
  | 'REVERSALS';

@Index(['accountKey'], { unique: true })
@Entity()
export class LedgerAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  accountKey!: string;

  @Column({ type: 'varchar' })
  type!: LedgerAccountType;

  @Column({ type: 'enum', enum: ['NGN', 'USD', 'GBP'] })
  currency!: Currency;

  @Column()
  name!: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ nullable: true })
  userId?: string;

  @ManyToOne(() => Wallet, { nullable: true })
  @JoinColumn({ name: 'walletId' })
  wallet?: Wallet;

  @Column({ nullable: true })
  walletId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
