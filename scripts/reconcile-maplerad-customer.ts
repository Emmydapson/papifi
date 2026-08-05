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

function maskId(id?: string) {
  if (!id) return undefined;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

async function main() {
  let userId = argValue('--user-id');
  const email = argValue('--email');
  const customerId = argValue('--maplerad-customer-id');
  const confirmed = args.includes('--confirm');

  if (!userId && !email) {
    console.error('Usage: npm run maplerad:reconcile-customer -- --user-id <papafi-user-id> [--maplerad-customer-id <maplerad-customer-id>] [--confirm]');
    console.error('   or: npm run maplerad:reconcile-customer -- --email <papafi-user-email> [--maplerad-customer-id <maplerad-customer-id>] [--confirm]');
    process.exit(2);
  }

  await AppDataSource.initialize();
  try {
    const userRepo = AppDataSource.getRepository(User);
    const user = userId
      ? await userRepo.findOne({ where: { id: userId } })
      : await userRepo.findOne({ where: { email: email!.trim().toLowerCase() } });
    if (!user) throw new Error('Papafi user not found');
    userId = user.id;

    const service = new MapleRadService();
    if (!customerId) {
      const discovery = await service.discoverMatchingMapleradCustomers(user);
      console.log('Maplerad customer discovery');
      console.log(`Papafi user id: ${maskId(userId)}`);
      console.log(`Papafi user email: ${maskEmail(user.email)}`);
      console.log(`Environment: ${service.getEnvironment()}`);
      console.log(`Scanned provider customers: ${discovery.scanned}`);
      console.log(`Exact matches: ${discovery.exactMatches.length}`);
      console.log(`Partial matches: ${discovery.partialMatches.length}`);
      for (const match of discovery.exactMatches) {
        console.log(`Exact: customer=${maskId(match.customer.id)} fields=${match.matchedFields.join(',')}`);
      }
      for (const match of discovery.partialMatches.slice(0, 10)) {
        console.log(`Partial: customer=${maskId(match.customerId)} matched=${match.matchedFields.join(',') || 'none'} mismatches=${match.mismatches.join(',')}`);
      }
      console.log('Dry run only. Provide --maplerad-customer-id and --confirm to persist a manual link.');
      return;
    }

    const result = await service.reconcileExistingCustomer(userId, customerId, confirmed);

    console.log('Maplerad customer reconciliation');
    console.log(`Papafi user id: ${maskId(userId)}`);
    console.log(`Papafi user email: ${maskEmail(user.email)}`);
    console.log(`Maplerad customer id: ${maskId(customerId)}`);
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
