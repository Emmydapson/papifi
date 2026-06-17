import { BeforeRemove, BeforeUpdate, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index(['actorUserId', 'createdAt'])
@Index(['action', 'createdAt'])
@Entity()
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ nullable: true })
  actorUserId?: string;

  @Column({ nullable: true })
  targetUserId?: string;

  @Column()
  action!: string;

  @Column()
  entityType!: string;

  @Column({ nullable: true })
  entityId?: string;

  @Column({ nullable: true })
  ipAddress?: string;

  @Column({ nullable: true })
  userAgent?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt!: Date;

  @BeforeUpdate()
  preventUpdate() {
    throw new Error('Audit logs are immutable');
  }

  @BeforeRemove()
  preventRemove() {
    throw new Error('Audit logs are immutable');
  }
}
