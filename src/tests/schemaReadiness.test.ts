import test from 'node:test';
import assert from 'node:assert/strict';
import { findMissingRequiredSchemaColumns } from '../services/schemaReadiness';

const dataSourceWithColumns = (columns: string[]) =>
  ({
    getMetadata: () => ({
      schema: 'public',
      tableName: 'kyc_verifications',
      columns: [{ propertyName: 'attemptOutcome', databaseName: 'attemptOutcome' }],
    }),
    query: async (_sql: string, params: unknown[]) =>
      columns.includes(String(params[2])) ? [{ exists: 1 }] : [],
  }) as any;

test('schema readiness reports missing required entity columns', async () => {
  const missing = await findMissingRequiredSchemaColumns(dataSourceWithColumns([]));

  assert.deepEqual(missing, [
    {
      tableName: 'kyc_verifications',
      columnName: 'attemptOutcome',
      propertyName: 'attemptOutcome',
    },
  ]);
});

test('schema readiness accepts present required entity columns', async () => {
  const missing = await findMissingRequiredSchemaColumns(dataSourceWithColumns(['attemptOutcome']));

  assert.deepEqual(missing, []);
});
