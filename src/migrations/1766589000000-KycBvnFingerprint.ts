import { MigrationInterface, QueryRunner } from 'typeorm';

export class KycBvnFingerprint1766589000000 implements MigrationInterface {
  name = 'KycBvnFingerprint1766589000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kyc_verifications" ADD "bvnFingerprint" character varying`);
    await queryRunner.query(`CREATE INDEX "IDX_kyc_verifications_bvn_fingerprint" ON "kyc_verifications" ("userId", "type", "bvnFingerprint")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_kyc_verifications_bvn_fingerprint"`);
    await queryRunner.query(`ALTER TABLE "kyc_verifications" DROP COLUMN "bvnFingerprint"`);
  }
}
