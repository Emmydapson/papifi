import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

@Index(['provider', 'reference'], { unique: true })
@Entity()
export class WebhookEvent {
  @PrimaryColumn()
  id: string; // event ID from Maplerad

  @Column({ default: 'maplerad' })
  provider: string;

  @Column()
  type: string;

  @Column({ nullable: true })
  reference?: string;

  @CreateDateColumn()
  createdAt: Date;
}
