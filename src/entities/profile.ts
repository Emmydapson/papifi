import { Entity, Column, PrimaryGeneratedColumn, OneToOne, JoinColumn } from 'typeorm';
import { User } from './User';

@Entity()
export class Profile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, { cascade: true })
  @JoinColumn()
  user: User;

  @Column()
  fullName: string;  // Remains immutable from registration

  @Column({ unique: true })
  email: string;  // Added to store email permanently

  @Column({ nullable: true })
  address: string;  // Optional field

  @Column({ nullable: true })
  phoneNumber: string;  // Optional, as it's not mandatory in registration

  @Column({ nullable: true })
  country: string;  // Optional, can be updated later

  @Column({ type: 'date', nullable: true })
  dateOfBirth: string;  // Optional, can be updated later

  @Column()
  gender: string;  // Captured from registration, immutable

  @Column({ nullable: true })
  nationality: string;  // Optional, can be updated later
}
