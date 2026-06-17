import { AppDataSource } from '../database';
import { Transaction } from '../entities/Transaction';
import { User } from '../entities/User';

export type LimitKind = 'withdrawal' | 'transfer' | 'card_funding' | 'total_debit';
export type AccountTier = 'UNVERIFIED' | 'BVN_VERIFIED' | 'DOCUMENT_SUBMITTED' | 'APPROVED';

type LimitConfig = {
  perTransaction: number;
  dailyWithdrawal: number;
  dailyTransfer: number;
  dailyCardFunding: number;
  dailyTotalDebit: number;
};

export const tierLimits: Record<AccountTier, LimitConfig> = {
  UNVERIFIED: { perTransaction: 0, dailyWithdrawal: 0, dailyTransfer: 0, dailyCardFunding: 0, dailyTotalDebit: 0 },
  BVN_VERIFIED: { perTransaction: 100000, dailyWithdrawal: 500000, dailyTransfer: 500000, dailyCardFunding: 250000, dailyTotalDebit: 750000 },
  DOCUMENT_SUBMITTED: { perTransaction: 500000, dailyWithdrawal: 2000000, dailyTransfer: 2000000, dailyCardFunding: 1000000, dailyTotalDebit: 3000000 },
  APPROVED: { perTransaction: 2000000, dailyWithdrawal: 10000000, dailyTransfer: 10000000, dailyCardFunding: 5000000, dailyTotalDebit: 15000000 },
};

export const assertWithinLimit = (amount: number, usedToday: number, limit: number, label: string) => {
  if (amount <= 0) throw new Error('Amount must be greater than zero');
  if (limit <= 0) throw new Error(`${label} is not allowed for this account tier`);
  if (amount > limit) throw new Error(`${label} exceeds per-transaction limit`);
  if (usedToday + amount > limit) throw new Error(`${label} exceeds daily limit`);
};

export const assertDailyLimit = (amount: number, usedToday: number, limit: number, label: string) => {
  if (amount <= 0) throw new Error('Amount must be greater than zero');
  if (limit <= 0) throw new Error(`${label} is not allowed for this account tier`);
  if (usedToday + amount > limit) throw new Error(`${label} exceeds daily limit`);
};

export class LimitService {
  private startOfToday() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private getTier(user: User): AccountTier {
    return (user.accountTier || (user.isKYCVerified ? 'BVN_VERIFIED' : 'UNVERIFIED')) as AccountTier;
  }

  async assertCanDebit(user: User, kind: LimitKind, amount: number) {
    const tier = this.getTier(user);
    const limits = tierLimits[tier];
    const txRepo = AppDataSource.getRepository(Transaction);
    const since = this.startOfToday();

    const query = txRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.amount), 0)', 'total')
      .where('t.userId = :userId', { userId: user.id })
      .andWhere('t.createdAt >= :since', { since })
      .andWhere('t.status IN (:...statuses)', { statuses: ['PENDING', 'PROCESSING', 'SUCCESS'] })
      .andWhere('t.type IN (:...types)', { types: ['withdrawal', 'transfer'] });

    if (kind === 'withdrawal') query.andWhere('t.type = :type', { type: 'withdrawal' });
    if (kind === 'transfer') query.andWhere('t.type = :type AND (t.description IS NULL OR t.description != :cardFunding)', { type: 'transfer', cardFunding: 'Virtual card funding' });
    if (kind === 'card_funding') query.andWhere('t.type = :type AND t.description = :cardFunding', { type: 'transfer', cardFunding: 'Virtual card funding' });

    const rows = await query.getRawOne<{ total: string }>();
    const allDebitRows = await txRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.amount), 0)', 'total')
      .where('t.userId = :userId', { userId: user.id })
      .andWhere('t.createdAt >= :since', { since })
      .andWhere('t.status IN (:...statuses)', { statuses: ['PENDING', 'PROCESSING', 'SUCCESS'] })
      .andWhere('t.type IN (:...types)', { types: ['withdrawal', 'transfer'] })
      .getRawOne<{ total: string }>();

    const totalDebitToday = Number(rows?.total || 0);
    const allDebitsToday = Number(allDebitRows?.total || 0);
    const dailyLimit =
      kind === 'withdrawal'
        ? limits.dailyWithdrawal
        : kind === 'transfer'
          ? limits.dailyTransfer
          : kind === 'card_funding'
            ? limits.dailyCardFunding
            : limits.dailyTotalDebit;

    if (amount > limits.perTransaction) throw new Error('Amount exceeds per-transaction limit');
    assertWithinLimit(amount, totalDebitToday, dailyLimit, kind);
    assertDailyLimit(amount, allDebitsToday, limits.dailyTotalDebit, 'total daily debit');
  }
}

export const limitService = new LimitService();
