import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKycVerificationTable1759227568420 implements MigrationInterface {
    name = 'AddKycVerificationTable1759227568420'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "kyc_verifications" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "userId" character varying NOT NULL,
                "type" character varying NOT NULL,
                "status" character varying NOT NULL DEFAULT 'PENDING',
                "confidence" double precision,
                "metadata" jsonb,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_57b7c6b141dd225ce5dc95d7fb0" PRIMARY KEY ("id")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "kyc_verifications"`);
    }
}
