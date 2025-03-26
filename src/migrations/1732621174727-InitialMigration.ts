import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialMigration1732621174727 implements MigrationInterface {
    name = 'InitialMigration1732621174727';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create virtual_card table
        await queryRunner.query(`
            CREATE TABLE "virtual_card" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "walletId" character varying NOT NULL,
                "cardNumber" character varying NOT NULL,
                "cvv" character varying NOT NULL,
                "expirationDate" character varying NOT NULL,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_42a5e76c9d2229e675beffd98ca" PRIMARY KEY ("id")
            )
        `);

        // Update null values with a default value in user table
        await queryRunner.query(`
            UPDATE "user"
            SET "phoneNumber" = 'default_phone_number'
            WHERE "phoneNumber" IS NULL
        `);

        // Remove duplicate phone numbers to ensure uniqueness
        await queryRunner.query(`
            DELETE FROM "user"
            WHERE "id" NOT IN (
                SELECT MIN("id")
                FROM "user"
                GROUP BY "phoneNumber"
            )
        `);

        // Alter the column to NOT NULL
        await queryRunner.query(`
            ALTER TABLE "user"
            ALTER COLUMN "phoneNumber" SET NOT NULL
        `);

        // Add unique constraint
        await queryRunner.query(`
            ALTER TABLE "user"
            ADD CONSTRAINT "UQ_user_phoneNumber" UNIQUE ("phoneNumber")
        `);

        // Create transaction_currency_enum type
        await queryRunner.query(`
            CREATE TYPE "public"."transaction_currency_enum" AS ENUM('USD', 'GBP', 'NGN')
        `);

        // Create transaction table
        await queryRunner.query(`
            CREATE TABLE "transaction" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "senderWalletId" character varying NOT NULL,
                "recipientWalletId" character varying NOT NULL,
                "amount" numeric NOT NULL,
                "currency" "public"."transaction_currency_enum" NOT NULL,
                "description" character varying NOT NULL,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_89eadb93a89810556e1cbcd6ab9" PRIMARY KEY ("id")
            )
        `);

        // Modify user table
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "UQ_fullName"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "fullName"`);
        await queryRunner.query(`ALTER TABLE "user" ADD "lastName" character varying DEFAULT 'default_lastName'`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "lastName" SET NOT NULL`);
        await queryRunner.query(`
            CREATE TYPE "public"."user_role_enum" AS ENUM('user', 'admin', 'super_admin')
        `);
        await queryRunner.query(`ALTER TABLE "user" ADD "role" "public"."user_role_enum" NOT NULL DEFAULT 'user'`);

        // Modify profile table
        await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "fullName"`);
        await queryRunner.query(`ALTER TABLE "profile" ADD "firstName" character varying DEFAULT 'default_firstName'`);
        await queryRunner.query(`ALTER TABLE "profile" ADD "lastName" character varying DEFAULT 'default_lastName'`);
        await queryRunner.query(`
            ALTER TABLE "profile"
            ADD "email" character varying NOT NULL DEFAULT 'default@example.com'
        `);

        await queryRunner.query(`
            ALTER TABLE "profile" ADD CONSTRAINT "UQ_profile_email" UNIQUE ("email")
        `);

        // Update existing rows to avoid NOT NULL errors
        await queryRunner.query(`
            UPDATE "profile"
            SET "firstName" = 'default_firstName', "lastName" = 'default_lastName'
            WHERE "firstName" IS NULL OR "lastName" IS NULL
        `);

        // Set NOT NULL after updating existing rows
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "firstName" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "lastName" SET NOT NULL`);

        // Alter profile table columns to drop NOT NULL constraints
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "phoneNumber" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "country" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "dateOfBirth" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "nationality" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revert all changes (if applicable) here...
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "nationality" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "dateOfBirth" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "country" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" ALTER COLUMN "phoneNumber" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "profile" DROP CONSTRAINT "UQ_profile_email"`);
        await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "email"`);
        await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "lastName"`);
        await queryRunner.query(`ALTER TABLE "profile" DROP COLUMN "firstName"`);
        await queryRunner.query(`ALTER TABLE "profile" ADD "fullName" character varying NOT NULL`);
        await queryRunner.query(`DROP TYPE "public"."user_role_enum"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "role"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "lastName"`);
        await queryRunner.query(`ALTER TABLE "user" ADD "fullName" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "UQ_fullName" UNIQUE ("fullName")`);
        await queryRunner.query(`DROP TABLE "transaction"`);
        await queryRunner.query(`DROP TYPE "public"."transaction_currency_enum"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "UQ_user_phoneNumber"`);
        await queryRunner.query(`ALTER TABLE "user" ALTER COLUMN "phoneNumber" DROP NOT NULL`);
        await queryRunner.query(`DROP TABLE "virtual_card"`);
    }
}
