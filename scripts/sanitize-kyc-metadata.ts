import 'dotenv/config';
import { AppDataSource } from '../src/database';
import { KycVerification } from '../src/entities/KycVerification';

const writeMode = process.argv.includes('--write');

const safeMetadata = (verification: KycVerification) => {
  const metadata = verification.metadata || {};
  const safe: Record<string, unknown> = {};

  if (metadata.provider) safe.provider = metadata.provider;
  if (metadata.providerEnvironment) safe.providerEnvironment = metadata.providerEnvironment;
  if (metadata.providerStatus !== undefined) safe.providerStatus = metadata.providerStatus;
  if (metadata.providerHttpStatus !== undefined) safe.providerHttpStatus = metadata.providerHttpStatus;
  if (metadata.providerRequestId) safe.providerRequestId = metadata.providerRequestId;
  if (metadata.providerErrorCode) safe.providerErrorCode = metadata.providerErrorCode;
  if (metadata.providerMessage) safe.providerMessage = metadata.providerMessage;
  if (metadata.bvn?.last4) {
    safe.bvn = { last4: String(metadata.bvn.last4), length: Number(metadata.bvn.length) || 11 };
  }

  if (verification.type !== 'BVN') {
    if (metadata.issuedCountry) safe.issuedCountry = metadata.issuedCountry;
    if (metadata.expiresAt) safe.expiresAt = metadata.expiresAt;
  }

  return safe;
};

const hasUnsafeMetadata = (metadata: any) => {
  if (!metadata || typeof metadata !== 'object') return false;
  return Boolean(
    metadata.providerResponse ||
      metadata.identity ||
      metadata.image ||
      metadata.dob ||
      metadata.phone_number ||
      metadata.first_name ||
      metadata.middle_name ||
      metadata.last_name ||
      metadata.documentNumber ||
      metadata.frontImageUrl ||
      metadata.backImageUrl ||
      metadata.selfieImageUrl ||
      metadata.note ||
      metadata.responseKeys ||
      metadata.dataKeys
  );
};

const hasIdentityProviderResponse = (metadata: any) =>
  Boolean(
    metadata?.providerResponse &&
      (metadata.providerResponse.first_name ||
        metadata.providerResponse.last_name ||
        metadata.providerResponse.dob ||
        metadata.providerResponse.phone_number ||
        metadata.providerResponse.image)
  );

async function main() {
  await AppDataSource.initialize();
  const queryRunner = AppDataSource.createQueryRunner();
  const hasKycTable = await queryRunner.hasTable('kyc_verifications');
  await queryRunner.release();
  if (!hasKycTable) {
    console.log(JSON.stringify({
      dryRun: !writeMode,
      inspected: 0,
      unsafe: 0,
      updated: 0,
      suspiciousFailedIds: [],
      skipped: 'kyc_verifications table does not exist',
    }));
    return;
  }

  const repo = AppDataSource.getRepository(KycVerification);
  const records = await repo.createQueryBuilder('kyc').where('kyc.metadata IS NOT NULL').getMany();

  let inspected = 0;
  let unsafe = 0;
  let updated = 0;
  const suspiciousFailedIds: string[] = [];

  await AppDataSource.transaction(async (manager) => {
    for (const record of records) {
      inspected++;
      if (!hasUnsafeMetadata(record.metadata)) continue;
      unsafe++;
      if (record.status === 'FAILED' && hasIdentityProviderResponse(record.metadata)) {
        suspiciousFailedIds.push(record.id);
      }
      if (!writeMode) continue;
      record.metadata = safeMetadata(record);
      await manager.getRepository(KycVerification).save(record);
      updated++;
    }
  });

  console.log(JSON.stringify({
    dryRun: !writeMode,
    inspected,
    unsafe,
    updated,
    suspiciousFailedIds,
  }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'sanitize_failed' }));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });
