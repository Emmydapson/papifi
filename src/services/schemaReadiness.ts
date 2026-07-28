import { DataSource, EntityTarget } from 'typeorm';
import { KycVerification } from '../entities/KycVerification';

type SchemaCheckDataSource = Pick<DataSource, 'getMetadata' | 'query'>;

type RequiredEntityColumn = {
  entity: EntityTarget<unknown>;
  propertyName: string;
};

export type MissingSchemaColumn = {
  tableName: string;
  columnName: string;
  propertyName: string;
};

export const requiredSchemaColumns: RequiredEntityColumn[] = [
  { entity: KycVerification, propertyName: 'attemptOutcome' },
];

export const findMissingRequiredSchemaColumns = async (
  dataSource: SchemaCheckDataSource,
): Promise<MissingSchemaColumn[]> => {
  const missing: MissingSchemaColumn[] = [];

  for (const required of requiredSchemaColumns) {
    const metadata = dataSource.getMetadata(required.entity);
    const column = metadata.columns.find((candidate) => candidate.propertyName === required.propertyName);
    if (!column) {
      missing.push({
        tableName: metadata.tableName,
        columnName: required.propertyName,
        propertyName: required.propertyName,
      });
      continue;
    }

    const rows = await dataSource.query(
      `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = COALESCE($1, current_schema())
          AND table_name = $2
          AND column_name = $3
        LIMIT 1
      `,
      [metadata.schema || 'public', metadata.tableName, column.databaseName],
    );

    if (rows.length === 0) {
      missing.push({
        tableName: metadata.tableName,
        columnName: column.databaseName,
        propertyName: required.propertyName,
      });
    }
  }

  return missing;
};

export const getSchemaReadiness = async (dataSource: SchemaCheckDataSource) => {
  const missingColumns = await findMissingRequiredSchemaColumns(dataSource);

  return {
    ready: missingColumns.length === 0,
    missingColumns,
  };
};
