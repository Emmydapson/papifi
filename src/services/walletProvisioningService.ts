import { LessThanOrEqual } from 'typeorm';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import { Currency, Wallet } from '../entities/Wallet';
import { ProviderReference } from '../entities/ProviderReference';
import { WalletProvisioningJob, WalletProvisioningState } from '../entities/WalletProvisioningJob';
import {
  isMapleradProviderError,
  mapleradErrorToApplicationCode,
  MapleRadService,
} from './mapleradService';
import { auditService } from './auditService';
import { logger } from './logger';

type ProvisionOptions = {
  forceRetry?: boolean;
  processNow?: boolean;
  actorUserId?: string;
};

const publicMessage = (state: WalletProvisioningState | 'NOT_STARTED') => {
  if (state === 'PROVISIONED') return 'Your NGN wallet is ready.';
  if (state === 'RECONCILIATION_REQUIRED') return 'Wallet provisioning requires account review.';
  if (state === 'FAILED') return 'Wallet provisioning could not be completed automatically.';
  if (state === 'NOT_STARTED') return 'Wallet provisioning has not started.';
  if (state === 'PROCESSING') return 'Your NGN wallet is being created.';
  if (state === 'RETRYING') return 'Your NGN wallet creation will be retried.';
  return 'Your NGN wallet is being created.';
};

class WalletProvisioningService {
  private mapleRadService: MapleRadService | undefined;

  private service() {
    return (this.mapleRadService ??= new MapleRadService());
  }

  private environment() {
    return this.service().getEnvironment();
  }

  private jobRepo() {
    return AppDataSource.getRepository(WalletProvisioningJob);
  }

  async userEligibleForDefaultNgnWallet(userId: string) {
    const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) return { eligible: false, code: 'USER_NOT_FOUND' };
    if (!user.isVerified) return { eligible: false, code: 'EMAIL_VERIFICATION_REQUIRED' };
    if (!user.transactionPin) return { eligible: false, code: 'TRANSACTION_PIN_REQUIRED' };
    if (!user.isKYCVerified && user.accountTier === 'UNVERIFIED') return { eligible: false, code: 'KYC_REQUIRED' };
    const customerReference = await AppDataSource.getRepository(ProviderReference).findOne({
      where: {
        userId,
        provider: 'maplerad',
        providerEnvironment: this.environment(),
        referenceType: 'customer',
      },
    });
    if (customerReference?.metadata?.tier1EnrollmentState !== 'TIER_1' && customerReference?.status !== 'tier1_confirmed') {
      return { eligible: false, code: 'MAPLERAD_TIER1_REQUIRED' };
    }
    return { eligible: true, user };
  }

  async ensureJob(userId: string, currency: Currency = 'NGN') {
    const repo = this.jobRepo();
    const existing = await repo.findOne({
      where: { userId, provider: 'maplerad', providerEnvironment: this.environment(), currency },
    });
    if (existing) return existing;

    try {
      return await repo.save(
        repo.create({
          user: { id: userId } as User,
          userId,
          provider: 'maplerad',
          providerEnvironment: this.environment(),
          currency,
          state: 'PENDING',
          nextAttemptAt: new Date(),
        })
      );
    } catch {
      const raced = await repo.findOne({
        where: { userId, provider: 'maplerad', providerEnvironment: this.environment(), currency },
      });
      if (raced) return raced;
      throw new Error('Unable to create wallet provisioning job');
    }
  }

  async enqueueDefaultNgnWalletProvisioning(userId: string) {
    const existingWallet = await AppDataSource.getRepository(Wallet).findOne({ where: { user: { id: userId }, currency: 'NGN' } });
    const job = await this.ensureJob(userId, 'NGN');
    if (existingWallet && job.state !== 'PROVISIONED') {
      job.state = 'PROVISIONED';
      job.safeReasonCode = null;
      job.nextAttemptAt = null;
      await this.jobRepo().save(job);
    }
    return this.publicStatus(job);
  }

  async getStatus(userId: string, currency: Currency = 'NGN') {
    const wallet = await AppDataSource.getRepository(Wallet).findOne({ where: { user: { id: userId }, currency } });
    if (wallet) {
      return { ok: true, currency, state: 'PROVISIONED' as const, message: publicMessage('PROVISIONED'), retryable: false, updatedAt: wallet.updatedAt };
    }
    const job = await this.jobRepo().findOne({
      where: { userId, provider: 'maplerad', providerEnvironment: this.environment(), currency },
    });
    if (!job) return { ok: true, currency, state: 'NOT_STARTED' as const, message: publicMessage('NOT_STARTED'), retryable: false };
    return this.publicStatus(job);
  }

  publicStatus(job: WalletProvisioningJob) {
    return {
      ok: true,
      currency: job.currency,
      state: job.state,
      message: publicMessage(job.state),
      retryable: ['PENDING', 'RETRYING', 'FAILED', 'RECONCILIATION_REQUIRED'].includes(job.state),
      reasonCode: job.state === 'RECONCILIATION_REQUIRED' || job.state === 'FAILED' ? job.safeReasonCode || undefined : undefined,
      updatedAt: job.updatedAt,
    };
  }

  async provisionDefaultNgnWallet(userId: string, options: ProvisionOptions = {}) {
    const eligibility = await this.userEligibleForDefaultNgnWallet(userId);
    const job = await this.ensureJob(userId, 'NGN');
    if (!eligibility.eligible) {
      job.state = 'FAILED';
      job.safeReasonCode = eligibility.code;
      job.nextAttemptAt = null;
      await this.jobRepo().save(job);
      return { job, wallet: null };
    }

    const existingWallet = await AppDataSource.getRepository(Wallet).findOne({ where: { user: { id: userId }, currency: 'NGN' } });
    const accountReference = await AppDataSource.getRepository(ProviderReference).findOne({
      where: {
        userId,
        provider: 'maplerad',
        providerEnvironment: this.environment(),
        referenceType: 'account',
        currency: 'NGN',
      },
    });
    if (existingWallet?.mapleradAccountId && accountReference?.providerAccountId) {
      job.state = 'PROVISIONED';
      job.safeReasonCode = null;
      job.nextAttemptAt = null;
      await this.jobRepo().save(job);
      return { job, wallet: existingWallet };
    }

    if (!options.forceRetry && ['PENDING', 'PROCESSING', 'RETRYING'].includes(job.state) && !options.processNow) {
      return { job, wallet: null };
    }

    job.state = 'PROCESSING';
    job.safeReasonCode = null;
    job.nextAttemptAt = null;
    await this.jobRepo().save(job);

    try {
      const wallet = await this.service().createVirtualAccountForUser(userId, 'NGN');
      job.state = 'PROVISIONED';
      job.safeReasonCode = null;
      job.nextAttemptAt = null;
      await this.jobRepo().save(job);
      await auditService.log({
        actorUserId: options.actorUserId || userId,
        targetUserId: userId,
        action: 'DEFAULT_NGN_WALLET_PROVISIONED',
        entityType: 'WalletProvisioningJob',
        entityId: job.id,
        metadata: { provider: 'maplerad', providerEnvironment: this.environment(), currency: 'NGN' },
      });
      return { job, wallet };
    } catch (error: any) {
      const code = isMapleradProviderError(error) ? mapleradErrorToApplicationCode(error) : 'PROVISIONING_FAILED';
      job.retryCount += 1;
      job.lastProviderRequestId = isMapleradProviderError(error) ? error.requestId || null : null;
      job.safeReasonCode = code;
      if (
        code === 'MAPLERAD_CUSTOMER_RECONCILIATION_REQUIRED' ||
        code === 'MAPLERAD_CUSTOMER_AMBIGUOUS' ||
        code === 'MAPLERAD_CUSTOMER_IDENTITY_MISMATCH' ||
        code === 'MAPLERAD_CUSTOMER_RECOVERY_PROFILE_INCOMPLETE'
      ) {
        job.state = 'RECONCILIATION_REQUIRED';
        job.nextAttemptAt = null;
      } else if (isMapleradProviderError(error) && ['TIMEOUT', 'NETWORK', 'RATE_LIMIT', 'PROVIDER'].includes(error.code)) {
        job.state = 'RETRYING';
        job.nextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, Math.pow(2, job.retryCount) * 60 * 1000));
      } else {
        job.state = 'FAILED';
        job.nextAttemptAt = null;
      }
      job.metadata = { lastError: isMapleradProviderError(error) ? error.code : 'UNKNOWN' };
      await this.jobRepo().save(job);
      logger.warn('default_ngn_wallet_provisioning_failed', {
        userId,
        providerEnvironment: this.environment(),
        state: job.state,
        safeReasonCode: job.safeReasonCode,
        retryCount: job.retryCount,
        requestId: job.lastProviderRequestId,
      });
      return { job, wallet: null };
    }
  }

  async processDueJobs(limit = 10) {
    const jobs = await this.jobRepo().find({
      where: [
        { provider: 'maplerad', providerEnvironment: this.environment(), currency: 'NGN', state: 'PENDING' },
        { provider: 'maplerad', providerEnvironment: this.environment(), currency: 'NGN', state: 'RETRYING', nextAttemptAt: LessThanOrEqual(new Date()) },
      ],
      order: { createdAt: 'ASC' },
      take: limit,
    });
    for (const job of jobs) {
      await this.provisionDefaultNgnWallet(job.userId, { processNow: true });
    }
    return jobs.length;
  }

  async listJobs(page = 1, limit = 50) {
    const safeLimit = Math.min(100, Math.max(1, limit));
    const [items, total] = await this.jobRepo().findAndCount({
      order: { updatedAt: 'DESC' },
      skip: (Math.max(1, page) - 1) * safeLimit,
      take: safeLimit,
    });
    return { page, limit: safeLimit, total, items: items.map((job) => this.adminResponse(job)) };
  }

  async getJob(id: string) {
    const job = await this.jobRepo().findOne({ where: { id } });
    return job ? this.adminResponse(job) : null;
  }

  async retryJob(id: string, actorUserId?: string) {
    const job = await this.jobRepo().findOne({ where: { id } });
    if (!job) return null;
    job.state = 'PENDING';
    job.safeReasonCode = null;
    job.nextAttemptAt = new Date();
    await this.jobRepo().save(job);
    await auditService.log({ actorUserId, targetUserId: job.userId, action: 'WALLET_PROVISIONING_RETRY_REQUESTED', entityType: 'WalletProvisioningJob', entityId: job.id });
    return this.provisionDefaultNgnWallet(job.userId, { forceRetry: true, processNow: true, actorUserId });
  }

  async markManualReview(id: string, actorUserId?: string) {
    const job = await this.jobRepo().findOne({ where: { id } });
    if (!job) return null;
    job.state = 'RECONCILIATION_REQUIRED';
    job.safeReasonCode = 'ADMIN_MANUAL_REVIEW';
    job.nextAttemptAt = null;
    await this.jobRepo().save(job);
    await auditService.log({ actorUserId, targetUserId: job.userId, action: 'WALLET_PROVISIONING_MARKED_MANUAL_REVIEW', entityType: 'WalletProvisioningJob', entityId: job.id });
    return this.adminResponse(job);
  }

  adminResponse(job: WalletProvisioningJob) {
    return {
      id: job.id,
      userId: job.userId,
      provider: job.provider,
      providerEnvironment: job.providerEnvironment,
      currency: job.currency,
      state: job.state,
      safeReasonCode: job.safeReasonCode,
      retryCount: job.retryCount,
      lastProviderRequestId: job.lastProviderRequestId,
      nextAttemptAt: job.nextAttemptAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}

export const walletProvisioningService = new WalletProvisioningService();
