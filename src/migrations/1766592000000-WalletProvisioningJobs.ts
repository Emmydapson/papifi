import { MigrationInterface, QueryRunner } from 'typeorm';

export class WalletProvisioningJobs1766592000000 implements MigrationInterface {
  name = 'WalletProvisioningJobs1766592000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "maplerad_customer_recovery_attempt"
      ADD COLUMN IF NOT EXISTS "identityFingerprint" character varying
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wallet_provisioning_job" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "provider" character varying NOT NULL,
        "providerEnvironment" character varying NOT NULL,
        "currency" "wallet_currency_enum" NOT NULL DEFAULT 'NGN',
        "state" character varying NOT NULL DEFAULT 'PENDING',
        "safeReasonCode" character varying,
        "retryCount" integer NOT NULL DEFAULT 0,
        "nextAttemptAt" TIMESTAMP,
        "lastProviderRequestId" character varying,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallet_provisioning_job_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_wallet_provisioning_job_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_wallet_provisioning_user_provider_env_currency"
      ON "wallet_provisioning_job" ("userId", "provider", "providerEnvironment", "currency")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wallet_provisioning_state_next"
      ON "wallet_provisioning_job" ("state", "nextAttemptAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wallet_provisioning_state_next"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wallet_provisioning_user_provider_env_currency"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wallet_provisioning_job"`);
    await queryRunner.query(`ALTER TABLE "maplerad_customer_recovery_attempt" DROP COLUMN IF EXISTS "identityFingerprint"`);
  }
}
