import { MigrationInterface, QueryRunner } from 'typeorm';

export class KycBvnFingerprint1766589000000 implements MigrationInterface {
  name = 'KycBvnFingerprint1766589000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kyc_verifications" ADD COLUMN IF NOT EXISTS "bvnFingerprint" character varying`);
    await queryRunner.query(`ALTER TABLE "kyc_verifications" ADD COLUMN IF NOT EXISTS "attemptOutcome" character varying`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kyc_verifications_bvn_fingerprint" ON "kyc_verifications" ("userId", "type", "bvnFingerprint")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kyc_verifications_user_type_status_created" ON "kyc_verifications" ("userId", "type", "status", "createdAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_kyc_verifications_user_type_status_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_kyc_verifications_bvn_fingerprint"`);
    await queryRunner.query(`ALTER TABLE "kyc_verifications" DROP COLUMN IF EXISTS "attemptOutcome"`);
    await queryRunner.query(`ALTER TABLE "kyc_verifications" DROP COLUMN IF EXISTS "bvnFingerprint"`);
  }
}
