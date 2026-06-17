import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase2LedgerArchitecture1765465000000 implements MigrationInterface {
  name = 'Phase2LedgerArchitecture1765465000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."transaction_status_enum" ADD VALUE IF NOT EXISTS 'PENDING'`);
    await queryRunner.query(`ALTER TYPE "public"."transaction_status_enum" ADD VALUE IF NOT EXISTS 'PROCESSING'`);
    await queryRunner.query(`ALTER TYPE "public"."transaction_status_enum" ADD VALUE IF NOT EXISTS 'SUCCESS'`);
    await queryRunner.query(`ALTER TYPE "public"."transaction_status_enum" ADD VALUE IF NOT EXISTS 'FAILED'`);
    await queryRunner.query(`ALTER TYPE "public"."transaction_status_enum" ADD VALUE IF NOT EXISTS 'REVERSED'`);

    const walletColumns = await queryRunner.getTable('wallet');
    if (walletColumns && !walletColumns.findColumnByName('availableBalance')) {
      await queryRunner.query(`ALTER TABLE "wallet" ADD "availableBalance" numeric(18,2) NOT NULL DEFAULT 0`);
    }
    if (walletColumns && !walletColumns.findColumnByName('pendingBalance')) {
      await queryRunner.query(`ALTER TABLE "wallet" ADD "pendingBalance" numeric(18,2) NOT NULL DEFAULT 0`);
    }
    if (walletColumns && !walletColumns.findColumnByName('ledgerBalance')) {
      await queryRunner.query(`ALTER TABLE "wallet" ADD "ledgerBalance" numeric(18,2) NOT NULL DEFAULT 0`);
    }

    await queryRunner.query(`
      UPDATE "wallet"
      SET
        "availableBalance" = CASE "currency"
          WHEN 'NGN' THEN COALESCE("NGN", 0)
          WHEN 'USD' THEN COALESCE("USD", 0)
          WHEN 'GBP' THEN COALESCE("GBP", 0)
          ELSE COALESCE("balance", 0)
        END,
        "pendingBalance" = COALESCE("pendingBalance", 0),
        "ledgerBalance" = CASE "currency"
          WHEN 'NGN' THEN COALESCE("NGN", 0)
          WHEN 'USD' THEN COALESCE("USD", 0)
          WHEN 'GBP' THEN COALESCE("GBP", 0)
          ELSE COALESCE("balance", 0)
        END
    `);

    const transactionTable = await queryRunner.getTable('transaction');
    const transactionColumns = new Set(transactionTable?.columns.map((column) => column.name) || []);
    if (!transactionColumns.has('idempotencyKey')) {
      await queryRunner.query(`ALTER TABLE "transaction" ADD "idempotencyKey" character varying`);
    }
    if (!transactionColumns.has('provider')) {
      await queryRunner.query(`ALTER TABLE "transaction" ADD "provider" character varying`);
    }
    if (!transactionColumns.has('providerReference')) {
      await queryRunner.query(`ALTER TABLE "transaction" ADD "providerReference" character varying`);
    }
    if (!transactionColumns.has('providerStatus')) {
      await queryRunner.query(`ALTER TABLE "transaction" ADD "providerStatus" character varying`);
    }
    if (!transactionColumns.has('providerPayload')) {
      await queryRunner.query(`ALTER TABLE "transaction" ADD "providerPayload" jsonb`);
    }
    if (!transactionColumns.has('settledAt')) {
      await queryRunner.query(`ALTER TABLE "transaction" ADD "settledAt" TIMESTAMP`);
    }
    if (!transactionColumns.has('failedAt')) {
      await queryRunner.query(`ALTER TABLE "transaction" ADD "failedAt" TIMESTAMP`);
    }
    if (!transactionColumns.has('reversedAt')) {
      await queryRunner.query(`ALTER TABLE "transaction" ADD "reversedAt" TIMESTAMP`);
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ledger_account" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "accountKey" character varying NOT NULL,
        "type" character varying NOT NULL,
        "currency" "public"."wallet_currency_enum" NOT NULL,
        "name" character varying NOT NULL,
        "userId" uuid,
        "walletId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ledger_account_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ledger_account_key" UNIQUE ("accountKey"),
        CONSTRAINT "FK_ledger_account_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_ledger_account_wallet" FOREIGN KEY ("walletId") REFERENCES "wallet"("id") ON DELETE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ledger_journal" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "type" character varying NOT NULL,
        "currency" "public"."wallet_currency_enum" NOT NULL,
        "idempotencyKey" character varying,
        "provider" character varying,
        "providerReference" character varying,
        "transactionId" character varying,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ledger_journal_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ledger_entry" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "journalId" uuid NOT NULL,
        "accountId" uuid NOT NULL,
        "debit" numeric(18,2) NOT NULL DEFAULT 0,
        "credit" numeric(18,2) NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ledger_entry_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ledger_entry_journal" FOREIGN KEY ("journalId") REFERENCES "ledger_journal"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ledger_entry_account" FOREIGN KEY ("accountId") REFERENCES "ledger_account"("id") ON DELETE NO ACTION,
        CONSTRAINT "CHK_ledger_entry_single_side" CHECK (("debit" >= 0 AND "credit" >= 0) AND NOT ("debit" > 0 AND "credit" > 0) AND ("debit" > 0 OR "credit" > 0))
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ledger_journal_idempotency" ON "ledger_journal" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ledger_journal_provider_reference" ON "ledger_journal" ("provider", "providerReference") WHERE "provider" IS NOT NULL AND "providerReference" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ledger_entry_journal" ON "ledger_entry" ("journalId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ledger_entry_account" ON "ledger_entry" ("accountId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_transaction_idempotency" ON "transaction" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_transaction_provider_reference" ON "transaction" ("provider", "providerReference")`);

    await queryRunner.query(`
      INSERT INTO "ledger_account" ("accountKey", "type", "currency", "name")
      SELECT DISTINCT 'system:PROVIDER_SETTLEMENT:' || currency, 'PROVIDER_SETTLEMENT', currency::wallet_currency_enum, 'Opening settlement ' || currency
      FROM (VALUES ('NGN'), ('USD'), ('GBP')) AS c(currency)
      ON CONFLICT ("accountKey") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "ledger_account" ("accountKey", "type", "currency", "name", "userId", "walletId")
      SELECT 'wallet:' || w."id" || ':' || c.currency,
        'USER_WALLET',
        c.currency::wallet_currency_enum,
        'Wallet ' || w."id" || ' ' || c.currency,
        w."userId",
        w."id"
      FROM "wallet" w
      CROSS JOIN (VALUES ('NGN'), ('USD'), ('GBP')) AS c(currency)
      ON CONFLICT ("accountKey") DO NOTHING
    `);

    await queryRunner.query(`
      WITH wallet_balances AS (
        SELECT w."id" AS "walletId", c.currency, c.amount
        FROM "wallet" w
        CROSS JOIN LATERAL (
          VALUES ('NGN', COALESCE(w."NGN", 0)), ('USD', COALESCE(w."USD", 0)), ('GBP', COALESCE(w."GBP", 0))
        ) AS c(currency, amount)
        WHERE c.amount > 0
      ), journals AS (
        INSERT INTO "ledger_journal" ("type", "currency", "idempotencyKey", "metadata")
        SELECT 'OPENING_BALANCE', wb.currency::wallet_currency_enum, 'opening:' || wb."walletId" || ':' || wb.currency, jsonb_build_object('walletId', wb."walletId")
        FROM wallet_balances wb
        ON CONFLICT DO NOTHING
        RETURNING "id", "idempotencyKey", "currency"
      )
      INSERT INTO "ledger_entry" ("journalId", "accountId", "debit", "credit")
      SELECT j."id", la."id", wb.amount, 0
      FROM journals j
      JOIN wallet_balances wb ON j."idempotencyKey" = 'opening:' || wb."walletId" || ':' || wb.currency
      JOIN "ledger_account" la ON la."accountKey" = 'system:PROVIDER_SETTLEMENT:' || wb.currency
      UNION ALL
      SELECT j."id", la."id", 0, wb.amount
      FROM journals j
      JOIN wallet_balances wb ON j."idempotencyKey" = 'opening:' || wb."walletId" || ':' || wb.currency
      JOIN "ledger_account" la ON la."accountKey" = 'wallet:' || wb."walletId" || ':' || wb.currency
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transaction_provider_reference"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transaction_idempotency"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ledger_entry_account"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ledger_entry_journal"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ledger_journal_provider_reference"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ledger_journal_idempotency"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ledger_entry"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ledger_journal"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ledger_account"`);
    await queryRunner.query(`ALTER TABLE "transaction" DROP COLUMN IF EXISTS "reversedAt"`);
    await queryRunner.query(`ALTER TABLE "transaction" DROP COLUMN IF EXISTS "failedAt"`);
    await queryRunner.query(`ALTER TABLE "transaction" DROP COLUMN IF EXISTS "settledAt"`);
    await queryRunner.query(`ALTER TABLE "transaction" DROP COLUMN IF EXISTS "providerPayload"`);
    await queryRunner.query(`ALTER TABLE "transaction" DROP COLUMN IF EXISTS "providerStatus"`);
    await queryRunner.query(`ALTER TABLE "transaction" DROP COLUMN IF EXISTS "providerReference"`);
    await queryRunner.query(`ALTER TABLE "transaction" DROP COLUMN IF EXISTS "provider"`);
    await queryRunner.query(`ALTER TABLE "transaction" DROP COLUMN IF EXISTS "idempotencyKey"`);
    await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN IF EXISTS "ledgerBalance"`);
    await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN IF EXISTS "pendingBalance"`);
    await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN IF EXISTS "availableBalance"`);
  }
}
