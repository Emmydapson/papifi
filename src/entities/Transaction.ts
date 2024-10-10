import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
  } from 'typeorm';
  
  @Entity()
  export class Transaction {
    @PrimaryGeneratedColumn('uuid')
    id!: string;
  
    @Column()
    senderWalletId!: string;
  
    @Column()
    recipientWalletId!: string;
  
    @Column({ type: 'decimal' })
    amount!: number;
  
    @Column({ type: 'enum', enum: ['USD', 'GBP', 'NGN'] })
    currency!: 'USD' | 'GBP' | 'NGN';
  
    @Column()
    description!: string;
  
    @CreateDateColumn()
    createdAt!: Date;
  }
  