import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './User';

@Entity()
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, (user) => user.wallets, { eager: true }) // Optional: set eager loading if needed
  user!: User;

  @Column({ type: 'decimal', default: 0 })
  NGN!: number;

  @Column({ type: 'decimal', default: 0 })
  GBP!: number;


  @Column({ type: 'decimal', default: 0 })
  USD!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
