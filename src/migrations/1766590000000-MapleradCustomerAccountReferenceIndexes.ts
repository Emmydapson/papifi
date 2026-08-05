import { MigrationInterface, QueryRunner } from 'typeorm';

export class MapleradCustomerAccountReferenceIndexes1766590000000 implements MigrationInterface {
  name = 'MapleradCustomerAccountReferenceIndexes1766590000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('provider_reference');
    if (!hasTable) return;

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_reference_user_env_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_reference_customer_env"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_reference_user_currency_env"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_reference_user_customer_env"
      ON "provider_reference" ("userId", "provider", "providerEnvironment", "referenceType")
      WHERE "referenceType" = 'customer'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_reference_customer_env_type"
      ON "provider_reference" ("provider", "providerEnvironment", "referenceType", "providerCustomerId")
      WHERE "providerCustomerId" IS NOT NULL AND "referenceType" = 'customer'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_reference_user_currency_env"
      ON "provider_reference" ("userId", "provider", "providerEnvironment", "currency")
      WHERE "currency" IS NOT NULL AND "referenceType" = 'account'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('provider_reference');
    if (!hasTable) return;

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_reference_user_currency_env"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_reference_customer_env_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_reference_user_customer_env"`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_reference_user_env_type" ON "provider_reference" ("userId", "provider", "providerEnvironment", "referenceType")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_reference_customer_env" ON "provider_reference" ("provider", "providerEnvironment", "providerCustomerId") WHERE "providerCustomerId" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_reference_user_currency_env" ON "provider_reference" ("userId", "provider", "providerEnvironment", "currency") WHERE "currency" IS NOT NULL`);
  }
}
