import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase3RiskAuditReconciliation1765470000000 implements MigrationInterface {
  name = 'Phase3RiskAuditReconciliation1765470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$ BEGIN CREATE TYPE "public"."user_accounttier_enum" AS ENUM('UNVERIFIED', 'BVN_VERIFIED', 'DOCUMENT_SUBMITTED', 'APPROVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "accountTier" "public"."user_accounttier_enum" NOT NULL DEFAULT 'UNVERIFIED'`);
    await queryRunner.query(`UPDATE "user" SET "accountTier" = 'BVN_VERIFIED' WHERE "isKYCVerified" = true AND "accountTier" = 'UNVERIFIED'`);

    await queryRunner.query(`ALTER TABLE "transaction" ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "transaction" ADD COLUMN IF NOT EXISTS "reconciledAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "transaction" ADD COLUMN IF NOT EXISTS "reconciliationStatus" character varying NOT NULL DEFAULT 'PENDING'`);
    await queryRunner.query(`ALTER TABLE "transaction" ADD COLUMN IF NOT EXISTS "reconciliationNotes" character varying`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_transaction_reconciliation" ON "transaction" ("reconciliationStatus", "status", "provider", "createdAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actorUserId" character varying,
        "targetUserId" character varying,
        "action" character varying NOT NULL,
        "entityType" character varying NOT NULL,
        "entityId" character varying,
        "ipAddress" character varying,
        "userAgent" character varying,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_log_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_actor_created" ON "audit_log" ("actorUserId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_action_created" ON "audit_log" ("action", "createdAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "risk_flag" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" character varying NOT NULL,
        "transactionId" character varying,
        "rule" character varying NOT NULL,
        "severity" character varying NOT NULL DEFAULT 'MEDIUM',
        "status" character varying NOT NULL DEFAULT 'OPEN',
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_risk_flag_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_risk_user_created" ON "risk_flag" ("userId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_risk_transaction" ON "risk_flag" ("transactionId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_risk_status_created" ON "risk_flag" ("status", "createdAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_risk_status_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_risk_transaction"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_risk_user_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "risk_flag"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_action_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_actor_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_log"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transaction_reconciliation"`);
    await queryRunner.query(`ALTER TABLE "transaction" DROP COLUMN IF EXISTS "reconciliationNotes"`);
    await queryRunner.query(`ALTER TABLE "transaction" DROP COLUMN IF EXISTS "reconciliationStatus"`);
    await queryRunner.query(`ALTER TABLE "transaction" DROP COLUMN IF EXISTS "reconciledAt"`);
    await queryRunner.query(`ALTER TABLE "transaction" DROP COLUMN IF EXISTS "lastCheckedAt"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "accountTier"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."user_accounttier_enum"`);
  }
}
