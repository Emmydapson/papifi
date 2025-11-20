import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1763637295310 implements MigrationInterface {
    name = 'InitialSchema1763637295310'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."wallet_currency_enum" AS ENUM('NGN', 'USD', 'GBP')`);
        await queryRunner.query(`CREATE TABLE "wallet" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "mapleradAccountId" character varying, "accountNumber" character varying, "bankName" character varying, "currency" "public"."wallet_currency_enum" NOT NULL DEFAULT 'NGN', "NGN" numeric(18,2) NOT NULL DEFAULT '0', "USD" numeric(18,2) NOT NULL DEFAULT '0', "GBP" numeric(18,2) NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "balance" numeric(18,2) NOT NULL DEFAULT '0', "userId" uuid, CONSTRAINT "PK_bec464dd8d54c39c54fd32e2334" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "kyc_verifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "type" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'PENDING', "confidence" double precision, "metadata" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_57b7c6b141dd225ce5dc95d7fb0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."user_role_enum" AS ENUM('user', 'admin', 'super_admin')`);
        await queryRunner.query(`CREATE TABLE "user" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "firstName" character varying NOT NULL, "lastName" character varying NOT NULL, "email" character varying NOT NULL, "phoneNumber" character varying NOT NULL, "gender" character varying NOT NULL, "transactionPin" character varying, "password" character varying NOT NULL, "googleId" character varying, "appleId" character varying, "otp" character varying, "otpExpiry" TIMESTAMP, "isVerified" boolean NOT NULL DEFAULT false, "mapleradCustomerId" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "isKYCVerified" boolean NOT NULL DEFAULT false, "role" "public"."user_role_enum" NOT NULL DEFAULT 'user', CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"), CONSTRAINT "UQ_f2578043e491921209f5dadd080" UNIQUE ("phoneNumber"), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "profile" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "firstName" character varying NOT NULL, "lastName" character varying NOT NULL, "email" character varying NOT NULL, "address" character varying, "phoneNumber" character varying, "country" character varying, "dateOfBirth" date, "gender" character varying NOT NULL, "nationality" character varying, "userId" uuid, CONSTRAINT "UQ_3825121222d5c17741373d8ad13" UNIQUE ("email"), CONSTRAINT "REL_a24972ebd73b106250713dcddd" UNIQUE ("userId"), CONSTRAINT "PK_3dd8bfc97e4a77c70971591bdcb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."virtual_card_status_enum" AS ENUM('active', 'inactive', 'blocked')`);
        await queryRunner.query(`CREATE TABLE "virtual_card" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "mapleradCardId" character varying, "cardNumber" character varying NOT NULL, "cvv" character varying NOT NULL, "expirationDate" character varying NOT NULL, "brand" character varying, "currency" character varying, "status" "public"."virtual_card_status_enum" NOT NULL DEFAULT 'active', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "isFrozen" boolean NOT NULL DEFAULT false, "walletId" uuid, CONSTRAINT "PK_42a5e76c9d2229e675beffd98ca" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."transaction_currency_enum" AS ENUM('USD', 'GBP', 'NGN')`);
        await queryRunner.query(`CREATE TYPE "public"."transaction_type_enum" AS ENUM('deposit', 'withdrawal', 'transfer')`);
        await queryRunner.query(`CREATE TYPE "public"."transaction_status_enum" AS ENUM('pending', 'success', 'failed')`);
        await queryRunner.query(`CREATE TABLE "transaction" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "amount" numeric(18,2) NOT NULL, "currency" "public"."transaction_currency_enum" NOT NULL, "type" "public"."transaction_type_enum" NOT NULL, "status" "public"."transaction_status_enum" NOT NULL DEFAULT 'pending', "reference" character varying, "description" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "senderWalletId" uuid, "recipientWalletId" uuid, "userId" uuid NOT NULL, CONSTRAINT "PK_89eadb93a89810556e1cbcd6ab9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "wallet" ADD CONSTRAINT "FK_35472b1fe48b6330cd349709564" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" ADD CONSTRAINT "FK_f71e34495dae27087b5773b35b4" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "profile" ADD CONSTRAINT "FK_a24972ebd73b106250713dcddd9" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "virtual_card" ADD CONSTRAINT "FK_ce9b846153b9f0a21f1a734857c" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "transaction" ADD CONSTRAINT "FK_3f062ad5434ca2ce2a1fc4e9494" FOREIGN KEY ("senderWalletId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "transaction" ADD CONSTRAINT "FK_dec0dcc358467041cdb9d5688b9" FOREIGN KEY ("recipientWalletId") REFERENCES "wallet"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "transaction" ADD CONSTRAINT "FK_605baeb040ff0fae995404cea37" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "transaction" DROP CONSTRAINT "FK_605baeb040ff0fae995404cea37"`);
        await queryRunner.query(`ALTER TABLE "transaction" DROP CONSTRAINT "FK_dec0dcc358467041cdb9d5688b9"`);
        await queryRunner.query(`ALTER TABLE "transaction" DROP CONSTRAINT "FK_3f062ad5434ca2ce2a1fc4e9494"`);
        await queryRunner.query(`ALTER TABLE "virtual_card" DROP CONSTRAINT "FK_ce9b846153b9f0a21f1a734857c"`);
        await queryRunner.query(`ALTER TABLE "profile" DROP CONSTRAINT "FK_a24972ebd73b106250713dcddd9"`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" DROP CONSTRAINT "FK_f71e34495dae27087b5773b35b4"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP CONSTRAINT "FK_35472b1fe48b6330cd349709564"`);
        await queryRunner.query(`DROP TABLE "transaction"`);
        await queryRunner.query(`DROP TYPE "public"."transaction_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."transaction_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."transaction_currency_enum"`);
        await queryRunner.query(`DROP TABLE "virtual_card"`);
        await queryRunner.query(`DROP TYPE "public"."virtual_card_status_enum"`);
        await queryRunner.query(`DROP TABLE "profile"`);
        await queryRunner.query(`DROP TABLE "user"`);
        await queryRunner.query(`DROP TYPE "public"."user_role_enum"`);
        await queryRunner.query(`DROP TABLE "kyc_verifications"`);
        await queryRunner.query(`DROP TABLE "wallet"`);
        await queryRunner.query(`DROP TYPE "public"."wallet_currency_enum"`);
    }

}
