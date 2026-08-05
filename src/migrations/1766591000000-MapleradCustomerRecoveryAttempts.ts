import { MigrationInterface, QueryRunner } from 'typeorm';

export class MapleradCustomerRecoveryAttempts1766591000000 implements MigrationInterface {
  name = 'MapleradCustomerRecoveryAttempts1766591000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "maplerad_customer_recovery_attempt" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "providerEnvironment" character varying NOT NULL,
        "result" character varying NOT NULL,
        "reason" character varying NOT NULL,
        "attemptedAt" TIMESTAMP NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_maplerad_customer_recovery_attempt_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_maplerad_customer_recovery_attempt_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_maplerad_customer_recovery_user_env_reason"
      ON "maplerad_customer_recovery_attempt" ("userId", "providerEnvironment", "reason")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_maplerad_customer_recovery_expires"
      ON "maplerad_customer_recovery_attempt" ("expiresAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_maplerad_customer_recovery_expires"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_maplerad_customer_recovery_user_env_reason"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "maplerad_customer_recovery_attempt"`);
  }
}
