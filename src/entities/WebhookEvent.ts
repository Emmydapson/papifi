import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

@Entity()
export class WebhookEvent {
  @PrimaryColumn()
  id: string; // event ID from Maplerad

  @Column()
  type: string;

  @CreateDateColumn()
  createdAt: Date;
}
