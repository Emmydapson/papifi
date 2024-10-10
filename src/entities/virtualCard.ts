import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
  } from 'typeorm';
  
  @Entity()
  export class VirtualCard {
    @PrimaryGeneratedColumn('uuid')
    id!: string;
  
    @Column()
    walletId!: string; // Linked to the wallet
  
    @Column()
    cardNumber!: string;
  
    @Column()
    cvv!: string;
  
    @Column()
    expirationDate!: string;
  
    @CreateDateColumn()
    createdAt!: Date;
  }
  