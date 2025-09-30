import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKycVerificationTable1759226016457 implements MigrationInterface {
    name = 'AddKycVerificationTable1759226016457'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "virtual_card" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "walletId" character varying NOT NULL, "cardNumber" character varying NOT NULL, "cvv" character varying NOT NULL, "expirationDate" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_42a5e76c9d2229e675beffd98ca" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."transaction_currency_enum" AS ENUM('USD', 'GBP', 'NGN')`);
        await queryRunner.query(`CREATE TABLE "transaction" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "senderWalletId" character varying NOT NULL, "recipientWalletId" character varying NOT NULL, "amount" numeric NOT NULL, "currency" "public"."transaction_currency_enum" NOT NULL, "description" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_89eadb93a89810556e1cbcd6ab9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "kyc_verifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "type" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'PENDING', "confidence" double precision, "metadata" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_57b7c6b141dd225ce5dc95d7fb0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "UQ_fullName"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "fullName"`);
        await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "fullName"`);
        await queryRunner.query(`ALTER TABLE "user" ADD "lastName" character varying NOT NULL`);
        await queryRunner.query(`CREATE TYPE "public"."user_role_enum" AS ENUM('user', 'admin', 'super_admin')`);
        await queryRunner.query(`ALTER TABLE "user" ADD "role" "public"."user_role_enum" NOT NULL DEFAULT 'user'`);
        await queryRunner.query(`ALTER TABLE "profile" ADD "firstName" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ADD "lastName" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ADD "email" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ADD CONSTRAINT "UQ_3825121222d5c17741373d8ad13" UNIQUE ("email")`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "phoneNumber" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "UQ_f2578043e491921209f5dadd080" UNIQUE ("phoneNumber")`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "UQ_a0f3f1de3c7590ddf4299b6596a"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "UQ_transactionPin"`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "phoneNumber" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "country" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "dateOfBirth" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "nationality" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "nationality" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "dateOfBirth" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "country" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "phoneNumber" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "UQ_transactionPin" UNIQUE ("transactionPin")`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "UQ_a0f3f1de3c7590ddf4299b6596a" UNIQUE ("gender")`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "UQ_f2578043e491921209f5dadd080"`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "phoneNumber" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" DROP CONSTRAINT "UQ_3825121222d5c17741373d8ad13"`);
        await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "email"`);
        await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "lastName"`);
        await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "firstName"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "role"`);
        await queryRunner.query(`DROP TYPE "public"."user_role_enum"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "lastName"`);
        await queryRunner.query(`ALTER TABLE "profile" ADD "fullName" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ADD "fullName" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "UQ_fullName" UNIQUE ("fullName")`);
        await queryRunner.query(`DROP TABLE "kyc_verifications"`);
        await queryRunner.query(`DROP TABLE "transaction"`);
        await queryRunner.query(`DROP TYPE "public"."transaction_currency_enum"`);
        await queryRunner.query(`DROP TABLE "virtual_card"`);
    }

}
