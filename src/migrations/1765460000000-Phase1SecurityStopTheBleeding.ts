import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase1SecurityStopTheBleeding1765460000000 implements MigrationInterface {
  name = 'Phase1SecurityStopTheBleeding1765460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasUserOtpPurpose = await queryRunner.hasColumn('user', 'otpPurpose');
    if (!hasUserOtpPurpose) {
      await queryRunner.query(`ALTER TABLE "user" ADD "otpPurpose" character varying`);
    }

    const hasCardLast4 = await queryRunner.hasColumn('virtual_card', 'cardLast4');
    if (!hasCardLast4) {
      await queryRunner.query(`ALTER TABLE "virtual_card" ADD "cardLast4" character varying`);
    }

    await queryRunner.query(`ALTER TABLE "virtual_card" ALTER COLUMN "cardNumber" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "virtual_card" ALTER COLUMN "cvv" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "virtual_card" ALTER COLUMN "expirationDate" DROP NOT NULL`);
    await queryRunner.query(`UPDATE "virtual_card" SET "cardLast4" = RIGHT("cardNumber", 4) WHERE "cardLast4" IS NULL AND "cardNumber" IS NOT NULL`);
    await queryRunner.query(`UPDATE "virtual_card" SET "cardNumber" = NULL, "cvv" = NULL`);

    const hasWebhookEvent = await queryRunner.hasTable('webhook_event');
    if (!hasWebhookEvent) {
      await queryRunner.query(`
        CREATE TABLE "webhook_event" (
          "id" character varying NOT NULL,
          "provider" character varying NOT NULL DEFAULT 'maplerad',
          "type" character varying NOT NULL,
          "reference" character varying,
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_webhook_event_id" PRIMARY KEY ("id")
        )
      `);
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_webhook_event_provider_reference" ON "webhook_event" ("provider", "reference") WHERE "reference" IS NOT NULL`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_transaction_reference_not_null" ON "transaction" ("reference") WHERE "reference" IS NOT NULL`
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_wallet_user_currency" ON "wallet" ("userId", "currency")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_transaction_user_created" ON "transaction" ("userId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kyc_user_created" ON "kyc_verifications" ("userId", "createdAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_kyc_user_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transaction_user_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wallet_user_currency"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transaction_reference_not_null"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhook_event_provider_reference"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_event"`);

    const hasCardLast4 = await queryRunner.hasColumn('virtual_card', 'cardLast4');
    if (hasCardLast4) {
      await queryRunner.query(`ALTER TABLE "virtual_card" DROP COLUMN "cardLast4"`);
    }

    const hasUserOtpPurpose = await queryRunner.hasColumn('user', 'otpPurpose');
    if (hasUserOtpPurpose) {
      await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "otpPurpose"`);
    }
  }
}
