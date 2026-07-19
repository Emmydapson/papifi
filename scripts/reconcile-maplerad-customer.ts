import 'dotenv/config';
import { AppDataSource } from '../src/database';
import { User } from '../src/entities/User';
import { MapleRadService } from '../src/services/mapleradService';

const args = process.argv.slice(2);

function argValue(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function maskEmail(email?: string) {
  if (!email) return undefined;
  const [local, domain] = email.split('@');
  if (!local || !domain) return '[invalid-email]';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(3, local.length - 2))}@${domain}`;
}

async function main() {
  const userId = argValue('--user-id');
  const customerId = argValue('--maplerad-customer-id');
  const confirmed = args.includes('--confirm');

  if (!userId || !customerId) {
    console.error('Usage: npm run maplerad:reconcile-customer -- --user-id <papafi-user-id> --maplerad-customer-id <maplerad-customer-id> [--confirm]');
    process.exit(2);
  }

  await AppDataSource.initialize();
  try {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) throw new Error('Papafi user not found');

    const service = new MapleRadService();
    const result = await service.reconcileExistingCustomer(userId, customerId, confirmed);

    console.log('Maplerad customer reconciliation');
    console.log(`Papafi user id: ${userId}`);
    console.log(`Papafi user email: ${maskEmail(user.email)}`);
    console.log(`Maplerad customer id: ${customerId}`);
    console.log(`Matched: ${result.matched ? 'yes' : 'no'}`);
    console.log(`Written: ${result.written ? 'yes' : 'no'}`);
    if ('mismatches' in result && result.mismatches?.length) {
      console.log(`Mismatches: ${result.mismatches.join(', ')}`);
    }
    if (!confirmed && result.matched) {
      console.log('Dry run only. Rerun with --confirm to persist this link and record an audit log.');
    }
    if (!result.matched) process.exit(1);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch(async (error) => {
  console.error(error?.message || String(error));
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});
