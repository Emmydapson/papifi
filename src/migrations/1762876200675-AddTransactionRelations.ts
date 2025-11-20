import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTransactionRelations1762876200675 implements MigrationInterface {
    name = 'AddTransactionRelations1762876200675'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create enums
        await queryRunner.query(`CREATE TYPE "public"."virtual_card_status_enum" AS ENUM('active', 'inactive', 'blocked')`);
        await queryRunner.query(`CREATE TYPE "public"."transaction_currency_enum" AS ENUM('USD', 'GBP', 'NGN')`);
        await queryRunner.query(`CREATE TYPE "public"."transaction_type_enum" AS ENUM('deposit', 'withdrawal', 'transfer')`);
        await queryRunner.query(`CREATE TYPE "public"."transaction_status_enum" AS ENUM('pending', 'success', 'failed')`);
        await queryRunner.query(`CREATE TYPE "public"."wallet_currency_enum" AS ENUM('NGN', 'USD', 'GBP')`);
        await queryRunner.query(`CREATE TYPE "public"."user_role_enum" AS ENUM('user', 'admin', 'super_admin')`);

        // Create tables
        await queryRunner.query(`
            CREATE TABLE "virtual_card" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "mapleradCardId" character varying,
                "cardNumber" character varying NOT NULL,
                "cvv" character varying NOT NULL,
                "expirationDate" character varying NOT NULL,
                "brand" character varying,
                "currency" character varying,
                "status" "public"."virtual_card_status_enum" NOT NULL DEFAULT 'active',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "isFrozen" boolean NOT NULL DEFAULT false,
                "walletId" uuid,
                CONSTRAINT "PK_42a5e76c9d2229e675beffd98ca" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "transaction" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "amount" numeric(18,2) NOT NULL,
                "currency" "public"."transaction_currency_enum" NOT NULL,
                "type" "public"."transaction_type_enum" NOT NULL,
                "status" "public"."transaction_status_enum" NOT NULL DEFAULT 'pending',
                "reference" character varying,
                "description" character varying,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "senderWalletId" uuid,
                "recipientWalletId" uuid,
                "userId" uuid NOT NULL,
                CONSTRAINT "PK_89eadb93a89810556e1cbcd6ab9" PRIMARY KEY ("id")
            )
        `);

        // Alter existing tables
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "UQ_fullName"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "fullName"`);
        await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "fullName"`);
        await queryRunner.query(`ALTER TABLE "wallet" ADD "mapleradAccountId" character varying`);
        await queryRunner.query(`ALTER TABLE "wallet" ADD "accountNumber" character varying`);
        await queryRunner.query(`ALTER TABLE "wallet" ADD "bankName" character varying`);
        await queryRunner.query(`ALTER TABLE "wallet" ADD "currency" "public"."wallet_currency_enum" NOT NULL DEFAULT 'NGN'`);
        await queryRunner.query(`ALTER TABLE "wallet" ADD "balance" numeric(18,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "user" ADD "lastName" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ADD "mapleradCustomerId" character varying`);
        await queryRunner.query(`ALTER TABLE "user" ADD "role" "public"."user_role_enum" NOT NULL DEFAULT 'user'`);
        await queryRunner.query(`ALTER TABLE "profile" ADD "firstName" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ADD "lastName" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ADD "email" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ADD CONSTRAINT "UQ_3825121222d5c17741373d8ad13" UNIQUE ("email")`);

        // Alter column types
        await queryRunner.query(`ALTER TABLE "wallet" ALTER COLUMN "NGN" TYPE numeric(18,2)`);
        await queryRunner.query(`ALTER TABLE "wallet" ALTER COLUMN "GBP" TYPE numeric(18,2)`);
        await queryRunner.query(`ALTER TABLE "wallet" ALTER COLUMN "USD" TYPE numeric(18,2)`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "phoneNumber" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "UQ_f2578043e491921209f5dadd080" UNIQUE ("phoneNumber")`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "UQ_a0f3f1de3c7590ddf4299b6596a"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "UQ_transactionPin"`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "phoneNumber" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "country" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "dateOfBirth" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "nationality" DROP NOT NULL`);

        // Foreign keys
        await queryRunner.query(`ALTER TABLE "kyc_verifications" ADD CONSTRAINT "FK_f71e34495dae27087b5773b35b4" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "virtual_card" ADD CONSTRAINT "FK_ce9b846153b9f0a21f1a734857c" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "transaction" ADD CONSTRAINT "FK_3f062ad5434ca2ce2a1fc4e9494" FOREIGN KEY ("senderWalletId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "transaction" ADD CONSTRAINT "FK_dec0dcc358467041cdb9d5688b9" FOREIGN KEY ("recipientWalletId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "transaction" ADD CONSTRAINT "FK_605baeb040ff0fae995404cea37" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop foreign keys first
        await queryRunner.query(`ALTER TABLE "transaction" DROP CONSTRAINT "FK_605baeb040ff0fae995404cea37"`);
        await queryRunner.query(`ALTER TABLE "transaction" DROP CONSTRAINT "FK_dec0dcc358467041cdb9d5688b9"`);
        await queryRunner.query(`ALTER TABLE "transaction" DROP CONSTRAINT "FK_3f062ad5434ca2ce2a1fc4e9494"`);
        await queryRunner.query(`ALTER TABLE "virtual_card" DROP CONSTRAINT "FK_ce9b846153b9f0a21f1a734857c"`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" DROP CONSTRAINT "FK_f71e34495dae27087b5773b35b4`);

        // Drop new columns, tables, and enums
        await queryRunner.query(`ALTER TABLE "profile" DROP CONSTRAINT "UQ_3825121222d5c17741373d8ad13"`);
        await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "email"`);
        await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "lastName"`);
        await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "firstName"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "role"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "mapleradCustomerId"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "lastName"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "balance"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "currency"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "bankName"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "accountNumber"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "mapleradAccountId"`);
        await queryRunner.query(`DROP TABLE "transaction"`);
        await queryRunner.query(`DROP TABLE "virtual_card"`);
        await queryRunner.query(`DROP TYPE "public"."virtual_card_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."transaction_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."transaction_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."transaction_currency_enum"`);
        await queryRunner.query(`DROP TYPE "public"."wallet_currency_enum"`);
        await queryRunner.query(`DROP TYPE "public"."user_role_enum"`);
    }
}
