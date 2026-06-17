import { MigrationInterface, QueryRunner } from 'typeorm';

export class WalletUsdAccountColumns1765473000000 implements MigrationInterface {
  name = 'WalletUsdAccountColumns1765473000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallet" ADD COLUMN IF NOT EXISTS "usdAccountId" character varying`);
    await queryRunner.query(`ALTER TABLE "wallet" ADD COLUMN IF NOT EXISTS "usdAccountStatus" character varying NOT NULL DEFAULT 'pending'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN IF EXISTS "usdAccountStatus"`);
    await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN IF EXISTS "usdAccountId"`);
  }
}
