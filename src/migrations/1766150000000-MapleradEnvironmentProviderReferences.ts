import { MigrationInterface, QueryRunner } from 'typeorm';

export class MapleradEnvironmentProviderReferences1766150000000 implements MigrationInterface {
  name = 'MapleradEnvironmentProviderReferences1766150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "provider_reference" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "provider" character varying NOT NULL,
        "providerEnvironment" character varying NOT NULL,
        "providerCustomerId" character varying,
        "providerAccountId" character varying,
        "accountNumber" character varying,
        "bankName" character varying,
        "currency" character varying,
        "status" character varying NOT NULL DEFAULT 'active',
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_provider_reference_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_provider_reference_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_reference_user_env" ON "provider_reference" ("userId", "provider", "providerEnvironment")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_reference_customer_env" ON "provider_reference" ("provider", "providerEnvironment", "providerCustomerId") WHERE "providerCustomerId" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_reference_account_env" ON "provider_reference" ("provider", "providerEnvironment", "providerAccountId") WHERE "providerAccountId" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_reference_user_currency_env" ON "provider_reference" ("userId", "provider", "providerEnvironment", "currency") WHERE "currency" IS NOT NULL`);

    await queryRunner.query(`ALTER TABLE "webhook_event" ADD COLUMN IF NOT EXISTS "providerEnvironment" character varying NOT NULL DEFAULT 'production'`);
    await queryRunner.query(`ALTER TABLE "webhook_event" ADD COLUMN IF NOT EXISTS "providerEventId" character varying`);
    await queryRunner.query(`UPDATE "webhook_event" SET "providerEventId" = "id" WHERE "providerEventId" IS NULL`);
    await queryRunner.query(`ALTER TABLE "webhook_event" ALTER COLUMN "providerEventId" SET NOT NULL`);
    await queryRunner.query(`
      DO $$
      DECLARE pk_name text;
      BEGIN
        SELECT conname INTO pk_name
        FROM pg_constraint
        WHERE conrelid = '"webhook_event"'::regclass AND contype = 'p';
        IF pk_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE "webhook_event" DROP CONSTRAINT %I', pk_name);
        END IF;
      END $$;
    `);
    await queryRunner.query(`ALTER TABLE "webhook_event" ALTER COLUMN "id" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "webhook_event" ALTER COLUMN "id" TYPE uuid USING uuid_generate_v4()`);
    await queryRunner.query(`ALTER TABLE "webhook_event" ALTER COLUMN "id" SET DEFAULT uuid_generate_v4()`);
    await queryRunner.query(`ALTER TABLE "webhook_event" ADD CONSTRAINT "PK_webhook_event_id" PRIMARY KEY ("id")`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_74b884706c5697cc7d4ccaeb33"`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_webhook_event_provider_env_reference" ON "webhook_event" ("provider", "providerEnvironment", "reference") WHERE "reference" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_webhook_event_provider_env_event" ON "webhook_event" ("provider", "providerEnvironment", "providerEventId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_wallet_user_currency" ON "wallet" ("userId", "currency")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wallet_user_currency"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhook_event_provider_env_event"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhook_event_provider_env_reference"`);
    await queryRunner.query(`ALTER TABLE "webhook_event" DROP COLUMN IF EXISTS "providerEventId"`);
    await queryRunner.query(`ALTER TABLE "webhook_event" DROP COLUMN IF EXISTS "providerEnvironment"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_reference_user_currency_env"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_reference_account_env"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_reference_customer_env"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_reference_user_env"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "provider_reference"`);
  }
}
