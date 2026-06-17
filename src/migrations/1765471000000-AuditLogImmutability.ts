import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditLogImmutability1765471000000 implements MigrationInterface {
  name = 'AuditLogImmutability1765471000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_log rows are immutable';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_audit_log_immutable_update" ON "audit_log"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_audit_log_immutable_delete" ON "audit_log"`);
    await queryRunner.query(`
      CREATE TRIGGER "TR_audit_log_immutable_update"
      BEFORE UPDATE ON "audit_log"
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation()
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_audit_log_immutable_delete"
      BEFORE DELETE ON "audit_log"
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_audit_log_immutable_delete" ON "audit_log"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_audit_log_immutable_update" ON "audit_log"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_audit_log_mutation()`);
  }
}
