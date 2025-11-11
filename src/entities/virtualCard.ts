import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Wallet } from './Wallet';

@Entity()
export class VirtualCard {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Wallet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'walletId' })
  wallet!: Wallet;

  @Column({ nullable: true })
  mapleradCardId?: string; // Maplerad card reference

  @Column()
  cardNumber!: string;

  @Column()
  cvv!: string;

  @Column()
  expirationDate!: string;

  @Column({ nullable: true })
  brand?: string; // e.g. VISA, MASTERCARD

  @Column({ nullable: true })
  currency?: string;

  @Column({ type: 'enum', enum: ['active', 'inactive', 'blocked'], default: 'active' })
  status!: 'active' | 'inactive' | 'blocked';

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'boolean', default: false })
isFrozen!: boolean;

}
