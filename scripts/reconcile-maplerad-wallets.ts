import 'dotenv/config';
import { AppDataSource } from '../src/database';
import { AuditLog } from '../src/entities/AuditLog';
import { ProviderReference } from '../src/entities/ProviderReference';
import { User } from '../src/entities/User';
import { Currency, Wallet } from '../src/entities/Wallet';
import { MapleRadService } from '../src/services/mapleradService';

const args = process.argv.slice(2);

function argValue(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function mask(value?: string | null) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return undefined;
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function accountId(account: any) {
  return account?.id || account?.account_id || account?.reference;
}

function currencyOf(account: any): Currency | undefined {
  const currency = String(account?.currency || '').toUpperCase();
  return currency === 'NGN' || currency === 'USD' ? currency : undefined;
}

function usdAccountStatusOf(status: unknown): Wallet['usdAccountStatus'] | undefined {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return 'pending';
  if (normalized === 'pending' || normalized === 'approved' || normalized === 'rejected') return normalized;
  return undefined;
}

async function main() {
  const userId = argValue('--user-id');
  const requestedEnvironment = argValue('--environment');
  const confirmed = args.includes('--confirm');

  if (!userId) {
    console.error('Usage: npm run maplerad:reconcile-wallets -- --user-id <papafi-user-id> --environment <sandbox|production> [--confirm]');
    process.exit(2);
  }
  await AppDataSource.initialize();
  try {
    const userRepo = AppDataSource.getRepository(User);
    const referenceRepo = AppDataSource.getRepository(ProviderReference);
    const walletRepo = AppDataSource.getRepository(Wallet);
    const service = new MapleRadService();
    const environment = service.getEnvironment();
    if (requestedEnvironment && requestedEnvironment !== environment) {
      throw new Error(`Requested environment ${requestedEnvironment} does not match resolved Maplerad environment ${environment}`);
    }

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) throw new Error('Papafi user not found');

    let customerReference = await referenceRepo.findOne({
      where: { userId, provider: 'maplerad', providerEnvironment: environment, referenceType: 'customer' },
    });
    if (!customerReference?.providerCustomerId && environment === 'production' && user.mapleradCustomerId) {
      const customer = await service.getCustomerById(user.mapleradCustomerId);
      if (confirmed) {
        customerReference = await referenceRepo.save(referenceRepo.create({
          user,
          userId,
          provider: 'maplerad',
          providerEnvironment: environment,
          referenceType: 'customer',
          externalReference: customer.id,
          providerCustomerId: customer.id,
          status: 'legacy_imported',
          metadata: { source: 'user.mapleradCustomerId', reconciledBy: 'maplerad:reconcile-wallets' },
        }));
      } else {
        customerReference = { providerCustomerId: customer.id } as ProviderReference;
      }
    }
    if (!customerReference?.providerCustomerId) {
      throw new Error('No verified environment-specific Maplerad customer reference exists. Link the customer first.');
    }

    const providerAccounts = (await service.getCustomerVirtualAccounts(customerReference.providerCustomerId))
      .filter((account) => currencyOf(account));
    const byCurrency = new Map<Currency, any[]>();
    for (const account of providerAccounts) {
      const currency = currencyOf(account)!;
      byCurrency.set(currency, [...(byCurrency.get(currency) || []), account]);
    }
    for (const [currency, accounts] of byCurrency.entries()) {
      if (accounts.length > 1) throw new Error(`Ambiguous ${currency} provider accounts; refusing reconciliation`);
    }

    const planned: any[] = [];
    for (const [currency, accounts] of byCurrency.entries()) {
      const account = accounts[0];
      const providerAccountId = accountId(account);
      if (!providerAccountId) throw new Error(`Provider ${currency} account is missing an account id`);

      const wallet = await walletRepo.findOne({ where: { user: { id: userId }, currency } });
      const reference = await referenceRepo.findOne({
        where: { userId, provider: 'maplerad', providerEnvironment: environment, referenceType: 'account', currency },
      });
      if (wallet?.mapleradAccountId && wallet.mapleradAccountId !== providerAccountId) {
        throw new Error(`Local ${currency} wallet conflicts with provider account; refusing reconciliation`);
      }
      if (reference?.providerAccountId && reference.providerAccountId !== providerAccountId) {
        throw new Error(`Local ${currency} provider reference conflicts with provider account; refusing reconciliation`);
      }
      planned.push({
        currency,
        providerAccountId,
        maskedAccountNumber: mask(account.account_number),
        bankName: account.bank_name || account.bank?.name,
        createWallet: !wallet,
        createProviderReference: !reference,
        account,
      });
    }

    console.log(`Maplerad wallet reconciliation (${environment})`);
    console.log(`Papafi user id: ${userId}`);
    for (const item of planned) {
      console.log(`${item.currency}: account=${item.maskedAccountNumber || '[unavailable]'} bank=${item.bankName || '[unavailable]'} createWallet=${item.createWallet ? 'yes' : 'no'} createProviderReference=${item.createProviderReference ? 'yes' : 'no'}`);
    }
    if (!confirmed) {
      console.log('Dry run only. Rerun with --confirm to create missing local rows.');
      return;
    }

    await AppDataSource.transaction(async (manager) => {
      for (const item of planned) {
        if (item.createWallet) {
          const wallet = manager.getRepository(Wallet).create({
            user,
            currency: item.currency,
            mapleradAccountId: item.providerAccountId,
            accountNumber: item.account.account_number,
            bankName: item.bankName,
            usdAccountId: item.currency === 'USD' ? item.providerAccountId : undefined,
            usdAccountStatus: item.currency === 'USD' ? usdAccountStatusOf(item.account.status) : undefined,
          });
          await manager.getRepository(Wallet).save(wallet);
        }
        if (item.createProviderReference) {
          await manager.getRepository(ProviderReference).save(manager.getRepository(ProviderReference).create({
            user,
            userId,
            provider: 'maplerad',
            providerEnvironment: environment,
            referenceType: 'account',
            externalReference: item.providerAccountId,
            providerCustomerId: customerReference!.providerCustomerId,
            providerAccountId: item.providerAccountId,
            accountNumber: item.account.account_number,
            bankName: item.bankName,
            currency: item.currency,
            status: String(item.account.status || 'active'),
            metadata: { reconciledBy: 'maplerad:reconcile-wallets' },
          }));
        }
      }
      await manager.getRepository(AuditLog).save(manager.getRepository(AuditLog).create({
        actorUserId: userId,
        targetUserId: userId,
        action: 'MAPLERAD_WALLETS_RECONCILED',
        entityType: 'User',
        entityId: userId,
        metadata: {
          provider: 'maplerad',
          providerEnvironment: environment,
          currencies: planned.map((item) => item.currency),
        },
      }));
    });

    console.log('Confirmed: missing local wallet/provider reference rows were created where needed.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch(async (error) => {
  console.error(error?.message || String(error));
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});
