import { MigrationInterface, QueryRunner } from 'typeorm';

export class LedgerImmutability1765472000000 implements MigrationInterface {
  name = 'LedgerImmutability1765472000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'ledger rows are immutable';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_ledger_journal_immutable_update" ON "ledger_journal"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_ledger_journal_immutable_delete" ON "ledger_journal"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_ledger_entry_immutable_update" ON "ledger_entry"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_ledger_entry_immutable_delete" ON "ledger_entry"`);

    await queryRunner.query(`
      CREATE TRIGGER "TR_ledger_journal_immutable_update"
      BEFORE UPDATE ON "ledger_journal"
      FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation()
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_ledger_journal_immutable_delete"
      BEFORE DELETE ON "ledger_journal"
      FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation()
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_ledger_entry_immutable_update"
      BEFORE UPDATE ON "ledger_entry"
      FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation()
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_ledger_entry_immutable_delete"
      BEFORE DELETE ON "ledger_entry"
      FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_ledger_entry_immutable_delete" ON "ledger_entry"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_ledger_entry_immutable_update" ON "ledger_entry"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_ledger_journal_immutable_delete" ON "ledger_journal"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_ledger_journal_immutable_update" ON "ledger_journal"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_ledger_mutation()`);
  }
}
