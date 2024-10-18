// src/entities/Profile.ts
import { Entity, Column, PrimaryGeneratedColumn, OneToOne, JoinColumn } from 'typeorm';
import { User } from './User';

@Entity()
export class Profile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, { cascade: true })
  @JoinColumn()
  user: User;

  @Column({name: 'fullname'})
  fullName: string;

  @Column({ nullable: true })
  address: string;

  @Column({name: 'phonenumber'})
  phoneNumber: string;

  @Column()
  country: string;

  @Column({ type: 'date' })
  dateOfBirth: string;

  @Column()
  gender: string;

  @Column()
  nationality: string;
}
