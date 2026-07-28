import { MigrationInterface, QueryRunner } from 'typeorm';

export class KycAttemptOutcome1766589200000 implements MigrationInterface {
  name = 'KycAttemptOutcome1766589200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kyc_verifications" ADD COLUMN IF NOT EXISTS "attemptOutcome" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Production rollback can discard attempt outcomes written after this migration.
    await queryRunner.query(`ALTER TABLE "kyc_verifications" DROP COLUMN IF EXISTS "attemptOutcome"`);
  }
}
