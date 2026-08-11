import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProfileTier1AddressFields1766593000000 implements MigrationInterface {
  name = 'ProfileTier1AddressFields1766593000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profile" ADD "city" character varying`);
    await queryRunner.query(`ALTER TABLE "profile" ADD "state" character varying`);
    await queryRunner.query(`ALTER TABLE "profile" ADD "postalCode" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "postalCode"`);
    await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "state"`);
    await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "city"`);
  }
}
