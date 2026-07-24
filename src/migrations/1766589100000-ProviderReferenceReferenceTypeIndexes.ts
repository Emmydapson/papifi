import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProviderReferenceReferenceTypeIndexes1766589100000 implements MigrationInterface {
  name = 'ProviderReferenceReferenceTypeIndexes1766589100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('provider_reference');
    if (!hasTable) return;

    await queryRunner.query(`ALTER TABLE "provider_reference" ADD COLUMN IF NOT EXISTS "referenceType" character varying NOT NULL DEFAULT 'customer'`);
    await queryRunner.query(`ALTER TABLE "provider_reference" ADD COLUMN IF NOT EXISTS "externalReference" character varying`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_reference_user_env"`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_reference_user_env_type" ON "provider_reference" ("userId", "provider", "providerEnvironment", "referenceType")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_reference_external_env_type" ON "provider_reference" ("provider", "providerEnvironment", "referenceType", "externalReference") WHERE "externalReference" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('provider_reference');
    if (!hasTable) return;

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_reference_external_env_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_provider_reference_user_env_type"`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_reference_user_env" ON "provider_reference" ("userId", "provider", "providerEnvironment")`);
  }
}
