import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
} from 'typeorm';
import { User } from './User';

@Entity()
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, (user) => user.wallets) // Inverse relation
  user!: User;

  @Column({ type: 'decimal', default: 0 })
  NGN!: number;

  @Column({ type: 'decimal', default: 0 })
  GBP!: number;

  @Column({ type: 'decimal', default: 0 })
  EUR!: number;

  @Column({ type: 'decimal', default: 0 })
  USD!: number;
}
