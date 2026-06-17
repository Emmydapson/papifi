import { AppDataSource } from '../database';
import { RiskFlag, RiskSeverity } from '../entities/RiskFlag';
import { Transaction } from '../entities/Transaction';
import { User } from '../entities/User';
import { MoreThan } from 'typeorm';

export const isLargeTransaction = (amount: number) => amount >= Number(process.env.RISK_LARGE_TRANSACTION_AMOUNT || 1000000);

export class RiskService {
  async flag(input: { userId: string; transactionId?: string; rule: string; severity?: RiskSeverity; metadata?: any }) {
    const repo = AppDataSource.getRepository(RiskFlag);
    return repo.save(repo.create({ ...input, severity: input.severity || 'MEDIUM', status: 'OPEN' }));
  }

  async evaluateMoneyMovement(user: User, amount: number, transaction?: Transaction) {
    if (isLargeTransaction(amount)) {
      await this.flag({
        userId: user.id,
        transactionId: transaction?.id,
        rule: 'LARGE_TRANSACTION',
        severity: 'HIGH',
        metadata: { amount },
      });
    }

    const accountAgeMs = Date.now() - new Date(user.createdAt).getTime();
    if (accountAgeMs < 7 * 24 * 60 * 60 * 1000 && amount >= 250000) {
      await this.flag({
        userId: user.id,
        transactionId: transaction?.id,
        rule: 'NEW_ACCOUNT_HIGH_VALUE_MOVEMENT',
        severity: 'HIGH',
        metadata: { amount },
      });
    }

    if (transaction) {
      const recentSince = new Date(Date.now() - 10 * 60 * 1000);
      const recentCount = await AppDataSource.getRepository(Transaction).count({
        where: {
          user: { id: user.id },
          type: transaction.type,
          createdAt: MoreThan(recentSince),
        },
      });
      if (recentCount >= 5) {
        await this.flag({
          userId: user.id,
          transactionId: transaction.id,
          rule: transaction.type === 'withdrawal' ? 'WITHDRAWAL_VELOCITY' : 'TRANSFER_VELOCITY',
          severity: 'HIGH',
          metadata: { recentCount, windowMinutes: 10 },
        });
      }
    }
  }
}

export const riskService = new RiskService();
