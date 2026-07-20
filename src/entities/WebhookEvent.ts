import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Index(['provider', 'providerEnvironment', 'reference'], { unique: true })
@Index(['provider', 'providerEnvironment', 'providerEventId'], { unique: true })
@Entity()
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  providerEventId: string; // event ID from Maplerad

  @Column({ default: 'maplerad' })
  provider: string;

  @Column({ default: 'production' })
  providerEnvironment: string;

  @Column()
  type: string;

  @Column({ nullable: true })
  reference?: string;

  @CreateDateColumn()
  createdAt: Date;
}
