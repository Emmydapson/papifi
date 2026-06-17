import { BeforeRemove, BeforeUpdate, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { LedgerAccount } from './LedgerAccount';
import { LedgerJournal } from './LedgerJournal';

@Index(['journalId'])
@Index(['accountId'])
@Entity()
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => LedgerJournal, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journalId' })
  journal!: LedgerJournal;

  @Column()
  journalId!: string;

  @ManyToOne(() => LedgerAccount, { nullable: false })
  @JoinColumn({ name: 'accountId' })
  account!: LedgerAccount;

  @Column()
  accountId!: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  debit!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  credit!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @BeforeUpdate()
  preventUpdate() {
    throw new Error('Ledger entries are immutable');
  }

  @BeforeRemove()
  preventRemove() {
    throw new Error('Ledger entries are immutable');
  }
}
