import { BeforeRemove, BeforeUpdate, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Currency } from './Wallet';

export type LedgerJournalType =
  | 'OPENING_BALANCE'
  | 'DEPOSIT'
  | 'WITHDRAWAL_HOLD'
  | 'WITHDRAWAL_RELEASE'
  | 'CARD_FUNDING_HOLD'
  | 'CARD_FUNDING_RELEASE'
  | 'CARD_WITHDRAWAL'
  | 'TRANSFER'
  | 'REVERSAL';

@Index(['idempotencyKey'], { unique: true })
@Index(['provider', 'providerReference'], { unique: true })
@Entity()
export class LedgerJournal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  type!: LedgerJournalType;

  @Column({ type: 'enum', enum: ['NGN', 'USD', 'GBP'] })
  currency!: Currency;

  @Column({ nullable: true })
  idempotencyKey?: string;

  @Column({ nullable: true })
  provider?: string;

  @Column({ nullable: true })
  providerReference?: string;

  @Column({ nullable: true })
  transactionId?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt!: Date;

  @BeforeUpdate()
  preventUpdate() {
    throw new Error('Ledger journals are immutable');
  }

  @BeforeRemove()
  preventRemove() {
    throw new Error('Ledger journals are immutable');
  }
}
