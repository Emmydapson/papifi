// src/services/mapleradService.ts
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import crypto from 'crypto';
import { EntityManager } from 'typeorm';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import { Currency, Wallet } from '../entities/Wallet';
import { Transaction } from '../entities/Transaction';
import { VirtualCard } from '../entities/virtualCard';
import { AuditLog } from '../entities/AuditLog';
import { logger } from './logger';

type MapleradEnvelope<T> = {
  status?: string | boolean;
  message?: string;
  data?: T;
  [key: string]: unknown;
};

type MapleradCustomer = {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  country?: string;
  tier?: string;
  phone?: unknown;
};

type MapleradVirtualAccount = {
  id?: string;
  account_id?: string;
  account_number?: string;
  account_name?: string;
  bank_name?: string;
  bank?: { name?: string; code?: string };
  currency?: Currency;
  status?: string;
  reference?: string;
  customer_id?: string;
};

type MapleradRequestOptions = {
  operation: string;
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  payload?: unknown;
  params?: Record<string, unknown>;
};

export class MapleradProviderError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly providerStatus?: number,
    public readonly providerMessage?: string,
    public readonly requestId?: string,
    public readonly safeResponseBody?: unknown,
    public readonly code: 'VALIDATION' | 'AUTH' | 'NOT_FOUND' | 'TIMEOUT' | 'NETWORK' | 'PROVIDER' | 'SCHEMA' = 'PROVIDER'
  ) {
    super(message);
    this.name = 'MapleradProviderError';
  }
}

export const isMapleradProviderError = (error: unknown): error is MapleradProviderError =>
  error instanceof MapleradProviderError;

export const mapleradErrorToHttpStatus = (error: unknown) => {
  if (!isMapleradProviderError(error)) return 502;
  if (error.code === 'VALIDATION') return error.providerStatus === 422 ? 422 : 400;
  if (error.code === 'AUTH') return 502;
  if (error.code === 'NOT_FOUND') return 400;
  if (error.code === 'SCHEMA') return 502;
  return 502;
};

type MapleradTransfer = {
  id?: string;
  reference?: string;
  status?: string;
};

type MapleradCard = {
  id?: string;
  reference?: string;
  card_number?: string;
  masked_pan?: string;
  expiry?: string;
  expiration?: string;
  brand?: string;
  issuer?: string;
  status?: string;
};

type MapleradWebhookHeaders = {
  svixId?: string;
  svixTimestamp?: string;
  svixSignature?: string;
};

export type MapleradWebhookEvent = {
  type: string;
  event: string;
  eventId: string;
  reference?: string;
  providerStatus?: string;
  providerPayload?: any;
  amount?: number;
  currency?: Currency;
  customerId?: string;
  accountId?: string;
  reason?: string;
};

/**
 * MapleRadService
 * - Uses p-queue for rate limiting
 * - Uses axios for HTTP
 * - Strong typing for responses (AxiosResponse)
 *
 * Notes:
 * - createVirtualCard accepts a walletId (matching your controller)
 * - Wallet currency reads/writes use helpers to avoid TS index signature issues
 */

 
export class MapleRadService {
  private readonly baseUrl = this.normalizeBaseUrl(process.env.MAPLERAD_BASE_URL || 'https://api.maplerad.com/v1');
  private readonly secretKey = process.env.MAPLERAD_SECRET || process.env.MAPLERAD_SECRET_KEY;
  private readonly publicKey = process.env.MAPLERAD_PUBLIC || process.env.MAPLERAD_PUBLIC_KEY;
  private readonly webhookSecret = process.env.MAPLERAD_WEBHOOK_SECRET;

  private userRepo = AppDataSource.getRepository(User);
  private walletRepo = AppDataSource.getRepository(Wallet);
  private txRepo = AppDataSource.getRepository(Transaction);
  private cardRepo = AppDataSource.getRepository(VirtualCard);

  private http: AxiosInstance;
 

  constructor() {
    if (!this.baseUrl.startsWith('https://')) {
      throw new Error('Maplerad API base URL must use HTTPS');
    }

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: Number(process.env.MAPLERAD_REQUEST_TIMEOUT_MS || 15000),
    });

    this.http.interceptors.request.use((config) => {
      config.headers = config.headers || {};
      if (!config.headers['X-Request-Id']) {
        config.headers['X-Request-Id'] = crypto.randomUUID();
      }
      return config;
    });

    this.http.interceptors.response.use(
      (res) => res,
      async (err) => {
        const config = err?.config;
        if (!config) return Promise.reject(err);

        const status = err?.response?.status;
        if (status) {
          logger.warn('maplerad_provider_request_failed', {
            method: String(config.method || 'GET').toUpperCase(),
            endpoint: this.endpointPath(config.url),
            status,
            requestId: err.response.headers?.['x-request-id'] || err.response.headers?.['x-amzn-requestid'],
          });
        }

        config.retryCount = config.retryCount || 0;

        const retryable = !status || status >= 500;
        if (retryable && config.retryCount < 2) {
          config.retryCount++;
          return this.http(config);
        }

        return Promise.reject(err);
      }
    );

    
  }

  getProviderName(): string {
    return 'MapleRad';
  }

  private normalizeBaseUrl(url: string) {
    const trimmed = url.trim().replace(/\/+$/, '');
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
  }

  private endpointPath(url?: string) {
    if (!url) return 'unknown';
    try {
      return new URL(url).pathname;
    } catch {
      return url.replace(this.baseUrl, '') || url;
    }
  }

  private unwrap<T>(res: AxiosResponse<MapleradEnvelope<T> | T>): T {
    const body = res.data as MapleradEnvelope<T>;
    return (body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : res.data) as T;
  }

  private sanitizeProviderPayload(value: any): any {
    if (Array.isArray(value)) return value.map((entry) => this.sanitizeProviderPayload(entry));
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        const normalized = key.toLowerCase();
        if (
          normalized.includes('authorization') ||
          normalized.includes('token') ||
          normalized.includes('secret') ||
          normalized.includes('bvn') ||
          normalized.includes('pan') ||
          normalized.includes('card_number') ||
          normalized.includes('cardnumber') ||
          normalized === 'cvv' ||
          normalized.includes('signature')
        ) {
          return [key, '[redacted]'];
        }
        return [key, this.sanitizeProviderPayload(entry)];
      })
    );
  }

  private providerErrorDetails(error: any) {
    if (isMapleradProviderError(error)) {
      return `${error.operation} returned ${error.providerStatus || error.code}${error.providerMessage ? `: ${error.providerMessage}` : ''}`;
    }
    const status = error?.response?.status;
    const endpoint = this.endpointPath(error?.config?.url);
    const providerMessage = error?.response?.data?.message || error?.response?.data?.error;
    if (status) return `${endpoint} returned ${status}${providerMessage ? `: ${String(providerMessage).slice(0, 160)}` : ''}`;
    return error?.message || 'provider_error';
  }

  private providerRequestId(headers: any) {
    return headers?.['x-request-id'] || headers?.['x-amzn-requestid'] || headers?.['request-id'];
  }

  private providerMessage(body: any) {
    const value = body?.message || body?.error || body?.errors?.[0]?.message || body?.detail;
    return value ? String(value).slice(0, 240) : undefined;
  }

  private providerErrorCode(status?: number, message?: string, axiosCode?: string): MapleradProviderError['code'] {
    const lower = String(message || '').toLowerCase();
    if (axiosCode === 'ECONNABORTED') return 'TIMEOUT';
    if (!status) return 'NETWORK';
    if (status === 401 || status === 403) return 'AUTH';
    if (status === 404) return 'NOT_FOUND';
    if (status === 400 || status === 422) return 'VALIDATION';
    if (lower.includes('validation')) return 'VALIDATION';
    return 'PROVIDER';
  }

  private async requestMaplerad<T>(options: MapleradRequestOptions): Promise<T> {
    try {
      const res = await this.http.request<MapleradEnvelope<T> | T>({
        method: options.method,
        url: options.path,
        data: options.payload,
        params: options.params,
        headers: this.getSecretHeaders(),
      });

      logger.info('maplerad_provider_request_succeeded', {
        operation: options.operation,
        endpoint: options.path,
        status: res.status,
        requestId: this.providerRequestId(res.headers),
      });
      return this.unwrap<T>(res);
    } catch (error: any) {
      const status = error?.response?.status;
      const safeBody = this.sanitizeProviderPayload(error?.response?.data);
      const providerMessage = this.providerMessage(error?.response?.data);
      const requestId = this.providerRequestId(error?.response?.headers);
      const code = this.providerErrorCode(status, providerMessage, error?.code);

      logger.error('maplerad_provider_request_failed', new Error('Maplerad provider request failed'), {
        operation: options.operation,
        endpoint: options.path,
        providerStatus: status,
        providerMessage,
        requestId,
        code,
      });

      throw new MapleradProviderError(
        `${options.operation} failed${status ? ` with Maplerad status ${status}` : ''}${providerMessage ? `: ${providerMessage}` : ''}`,
        options.operation,
        status,
        providerMessage,
        requestId,
        safeBody,
        code
      );
    }
  }

  private normalize(value?: string | null) {
    return String(value || '').trim().toLowerCase();
  }

  private normalizeName(value?: string | null) {
    return this.normalize(value).replace(/\s+/g, ' ');
  }

  private validateCustomerMatch(user: User, customer: MapleradCustomer) {
    const mismatches: string[] = [];
    if (customer.email && this.normalize(customer.email) !== this.normalize(user.email)) mismatches.push('email');
    if (customer.first_name && this.normalizeName(customer.first_name) !== this.normalizeName(user.firstName)) mismatches.push('first_name');
    if (customer.last_name && this.normalizeName(customer.last_name) !== this.normalizeName(user.lastName)) mismatches.push('last_name');
    return { ok: mismatches.length === 0, mismatches };
  }

  private getSecretHeaders() {
    if (!this.secretKey) throw new Error('Missing Maplerad secret key');
    return {
      Authorization: `Bearer ${this.secretKey!}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private getPublicHeaders() {
    if (!this.publicKey) throw new Error('Missing Maplerad public key');
    return {
      Authorization: `Bearer ${this.publicKey!}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /** -------------------------------
   * CUSTOMER MANAGEMENT
   * ------------------------------- */
  async getCustomerById(customerId: string): Promise<MapleradCustomer> {
    const customer = await this.requestMaplerad<MapleradCustomer>({
      operation: 'maplerad.customer.retrieve',
      method: 'GET',
      path: `/customers/${customerId}`,
    });
    if (!customer?.id) {
      throw new MapleradProviderError(
        'Maplerad customer retrieve returned malformed response',
        'maplerad.customer.retrieve',
        undefined,
        'missing customer id',
        undefined,
        this.sanitizeProviderPayload(customer),
        'SCHEMA'
      );
    }
    return customer;
  }

  async ensureMapleRadCustomer(userId: string): Promise<string> {
    return AppDataSource.transaction(async (manager) => this.ensureMapleRadCustomerForUser(userId, manager));
  }

  private async ensureMapleRadCustomerForUser(userId: string, manager: EntityManager): Promise<string> {
    const user = await manager.getRepository(User).findOne({
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) throw new Error('User not found');

    if (user.mapleradCustomerId) {
      const customer = await this.getCustomerById(user.mapleradCustomerId);
      const match = this.validateCustomerMatch(user, customer);
      if (!match.ok) {
        throw new MapleradProviderError(
          `Persisted Maplerad customer does not match Papafi user: ${match.mismatches.join(', ')}`,
          'maplerad.customer.validate_persisted',
          400,
          'persisted customer mismatch',
          undefined,
          { mismatches: match.mismatches },
          'VALIDATION'
        );
      }
      return user.mapleradCustomerId;
    }

    const payload = {
      first_name: user.firstName,
      last_name: user.lastName,
      email: user.email,
      country: 'NG',
    };

    try {
      const customer = await this.requestMaplerad<MapleradCustomer>({
        operation: 'maplerad.customer.create',
        method: 'POST',
        path: '/customers',
        payload,
      });

      const customerId = customer?.id;
      if (!customerId) {
        throw new MapleradProviderError(
          'Maplerad customer creation returned malformed response',
          'maplerad.customer.create',
          undefined,
          'missing customer id',
          undefined,
          this.sanitizeProviderPayload(customer),
          'SCHEMA'
        );
      }

      user.mapleradCustomerId = customerId;
      await manager.getRepository(User).save(user);
      return customerId;
    } catch (error) {
      if (
        isMapleradProviderError(error) &&
        error.code === 'VALIDATION' &&
        String(error.providerMessage || '').toLowerCase().includes('already enrolled')
      ) {
        throw new MapleradProviderError(
          'Maplerad customer already exists and must be linked with the admin reconciliation command before wallet creation can continue',
          'maplerad.customer.create',
          error.providerStatus,
          error.providerMessage,
          error.requestId,
          error.safeResponseBody,
          'VALIDATION'
        );
      }
      throw error;
    }
  }

  async reconcileExistingCustomer(userId: string, customerId: string, confirmed: boolean) {
    const providerCustomer = await this.getCustomerById(customerId);

    return AppDataSource.transaction(async (manager) => {
      const user = await manager.getRepository(User).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new Error('Papafi user not found');
      if (user.mapleradCustomerId && user.mapleradCustomerId !== customerId) {
        throw new Error('Papafi user is already linked to a different Maplerad customer');
      }

      const existingUser = await manager.getRepository(User).findOne({ where: { mapleradCustomerId: customerId } });
      if (existingUser && existingUser.id !== user.id) {
        throw new Error('Maplerad customer ID is already linked to another Papafi user');
      }

      const match = this.validateCustomerMatch(user, providerCustomer);
      if (!match.ok) {
        return {
          matched: false,
          written: false,
          mismatches: match.mismatches,
          user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
          providerCustomer: {
            id: providerCustomer.id,
            email: providerCustomer.email,
            firstName: providerCustomer.first_name,
            lastName: providerCustomer.last_name,
          },
        };
      }

      if (!confirmed) {
        return {
          matched: true,
          written: false,
          user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
          providerCustomer: {
            id: providerCustomer.id,
            email: providerCustomer.email,
            firstName: providerCustomer.first_name,
            lastName: providerCustomer.last_name,
          },
        };
      }

      user.mapleradCustomerId = customerId;
      await manager.getRepository(User).save(user);
      await manager.getRepository(AuditLog).save(
        manager.getRepository(AuditLog).create({
          actorUserId: user.id,
          targetUserId: user.id,
          action: 'MAPLERAD_CUSTOMER_RECONCILED',
          entityType: 'User',
          entityId: user.id,
          metadata: { mapleradCustomerId: customerId },
        })
      );

      return { matched: true, written: true, user: { id: user.id }, providerCustomer: { id: providerCustomer.id } };
    });
  }

  async upgradeCustomerTier1(payload: unknown): Promise<any> {
    return this.requestMaplerad({
      operation: 'maplerad.customer.upgrade_tier1',
      method: 'PATCH',
      path: '/customers/upgrade/tier1',
      payload,
    });
  }

  async verifyBvn(bvn: string): Promise<any> {
    const normalizedBvn = String(bvn).trim();
    if (!/^\d{11}$/.test(normalizedBvn)) {
      throw new MapleradProviderError(
        'BVN must be an 11-digit string',
        'maplerad.identity.verify_bvn',
        400,
        'invalid bvn format',
        undefined,
        undefined,
        'VALIDATION'
      );
    }

    const data = await this.requestMaplerad<any>({
      operation: 'maplerad.identity.verify_bvn',
      method: 'POST',
      path: '/identity/bvn',
      payload: { bvn: normalizedBvn },
    });

    if (!data || typeof data !== 'object') {
      throw new MapleradProviderError(
        'Maplerad BVN verification returned malformed response',
        'maplerad.identity.verify_bvn',
        undefined,
        'malformed response',
        undefined,
        this.sanitizeProviderPayload(data),
        'SCHEMA'
      );
    }

    return data;
  }

  async listCustomers(page = 1, pageSize = 1): Promise<MapleradCustomer[]> {
    const data: any = await this.requestMaplerad({
      operation: 'maplerad.customer.list',
      method: 'GET',
      path: '/customers',
      params: { page, page_size: pageSize },
    });
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.customers)) return data.customers;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }

  async getCustomerVirtualAccounts(customerId: string): Promise<MapleradVirtualAccount[]> {
    const data: any = await this.requestMaplerad({
      operation: 'maplerad.virtual_account.list_for_customer',
      method: 'GET',
      path: `/customers/${customerId}/virtual-account`,
    });
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.accounts)) return data.accounts;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.virtual_accounts)) return data.virtual_accounts;
    return [];
  }

  private findProviderVirtualAccount(accounts: MapleradVirtualAccount[], currency: Currency) {
    return accounts.find((account) => {
      const accountCurrency = String(account.currency || '').toUpperCase();
      return accountCurrency === currency && Boolean(account.account_number);
    });
  }

  private applyVirtualAccountToWallet(wallet: Wallet, data: MapleradVirtualAccount, currency: Currency) {
    wallet.mapleradAccountId = data.id || data.account_id;
    wallet.accountNumber = data.account_number;
    wallet.bankName = data.bank_name || data.bank?.name;
    wallet.currency = currency;
    return wallet;
  }

  /** -------------------------------
   * WALLET / DEPOSIT / WITHDRAWAL
   * ------------------------------- */
  async createVirtualAccountForUser(userId: string, currency: Currency = 'NGN'): Promise<any> {
    if (currency !== 'NGN') {
      throw new MapleradProviderError(
        'Maplerad static virtual account creation currently supports NGN only',
        'maplerad.virtual_account.create',
        400,
        'unsupported currency',
        undefined,
        { currency },
        'VALIDATION'
      );
    }

    return AppDataSource.transaction(async (manager) => {
      const user = await manager.getRepository(User).findOne({
        where: { id: userId },
        relations: ['wallets'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new Error(`MapleRad Error: User ${userId} not found`);

      const walletRepo = manager.getRepository(Wallet);
      const existingWallet = await walletRepo.findOne({ where: { user: { id: user.id }, currency } });
      if (existingWallet?.accountNumber && existingWallet?.mapleradAccountId) return existingWallet;

      const customerId = await this.ensureMapleRadCustomerForUser(user.id, manager);
      const providerAccounts = await this.getCustomerVirtualAccounts(customerId);
      let data = this.findProviderVirtualAccount(providerAccounts, currency);

      if (!data) {
        const payload = { customer_id: customerId, currency, preferred_bank: process.env.MAPLERAD_NGN_PREFERRED_BANK };
        if (!payload.preferred_bank) delete (payload as Partial<typeof payload>).preferred_bank;
        data = await this.requestMaplerad<MapleradVirtualAccount>({
          operation: 'maplerad.virtual_account.create',
          method: 'POST',
          path: '/collections/virtual-account',
          payload,
        });
      }

      if (!data?.account_number) {
        throw new MapleradProviderError(
          'Maplerad virtual account response did not include an account number',
          'maplerad.virtual_account.create',
          undefined,
          'missing account_number',
          undefined,
          this.sanitizeProviderPayload(data),
          'SCHEMA'
        );
      }

      const wallet = this.applyVirtualAccountToWallet(existingWallet || walletRepo.create({ user }), data, currency);
      await walletRepo.save(wallet);

      return data;
    });
  }

async createUsdVirtualAccount(userId: string): Promise<any> {
  const user = await this.userRepo.findOne({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  const customerId = await this.ensureMapleRadCustomer(user.id);

  const payload = {
    customer_id: customerId,
    meta: {
      // Maplerad requires onboarding metadata
      // adjust according to their docs
      first_name: user.firstName,
      last_name: user.lastName,
      email: user.email,
      country: 'NG', // or 'US' if you have users abroad
    },
  };

  const res: AxiosResponse = await this.http.post(
      '/collections/virtual-account/usd',
      payload,
      { headers: this.getSecretHeaders() }
    )
  

  const data = this.unwrap<MapleradVirtualAccount>(res);

  // data.reference means "account creation request started"
  if (!data?.reference) {
    throw new Error('USD account request did not return a reference');
  }

  return data;
}

async getUsdAccountRails(accountId: string): Promise<any> {
  if (!accountId) throw new Error('USD Account ID is required');

  const res: AxiosResponse = await this.http.get(
      `/collections/virtual-account/${accountId}/rails`,
      { headers: this.getSecretHeaders() }
    )
  

  return this.unwrap(res);
}

async getUsdVirtualAccountById(id: string): Promise<any> {
  if (!id) throw new Error('USD Virtual Account ID is required');

  const res: AxiosResponse = await this.http.get(
      `/collections/virtual-account/${id}`,
      { headers: this.getSecretHeaders() }
    )
  

  return this.unwrap(res);
}

async checkUsdAccountRequestStatus(reference: string): Promise<any> {
  if (!reference) throw new Error('USD account reference is required');

  const res: AxiosResponse = await this.http.get(
      `/collections/virtual-account/status/${reference}`,
      { headers: this.getSecretHeaders() }
    )
  

  return this.unwrap(res);
}


  async fundCard(cardId: string, amount: number, currency: Currency = 'USD'): Promise<any> {
    const card = await this.cardRepo.findOne({ where: { id: cardId }, relations: ['wallet'] });
    if (!card?.wallet) throw new Error('Card not found');

    const providerCardId = card.mapleradCardId || card.id;
    const scaled = Math.round(amount * 100);
    const res: AxiosResponse = await this.http.post(`/issuing/${providerCardId}/fund`, { amount: scaled }, { headers: this.getSecretHeaders() })
    

    const data = this.unwrap(res);

    return data;
  }

  async createWithdrawal(
    userId: string,
    amount: number,
    currency: Currency,
    destination: { bankCode: string; accountNumber: string; accountName?: string },
    description?: string
  ): Promise<any> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    const customerId = await this.ensureMapleRadCustomer(user.id);

    const payload = {
      amount: Math.round(amount * 100),
      currency,
      reason: description ?? 'Wallet withdrawal',
      bank_code: destination.bankCode,
      account_number: destination.accountNumber,
      reference: crypto.randomUUID(),
    };

    void customerId;
    void destination.accountName;

    const res: AxiosResponse<MapleradEnvelope<MapleradTransfer>> = await this.http.post('/transfers', payload, { headers: this.getSecretHeaders() })
    

    const data = this.unwrap<MapleradTransfer>(res);

    return data;
  }

  /** -------------------------------
   * VIRTUAL CARDS
   * -------------------------------
   *
   * Note: walletId expected (matches your controller)
   */
  async createVirtualCard(walletId: string, currency: Currency = 'USD', brand = 'VISA', amount?: number): Promise<any> {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId }, relations: ['user'] });
    if (!wallet) throw new Error('Wallet not found');

    const user = wallet.user;
    if (!user) throw new Error('Wallet has no associated user');

    const customerId = await this.ensureMapleRadCustomer(user.id);

    const payload: any = { customer_id: customerId, currency, type: 'VIRTUAL', auto_approve: true, brand };
    if (amount) payload.amount = Math.round(amount * 100); // Maplerad may expect smallest unit

    const res: AxiosResponse<MapleradEnvelope<MapleradCard>> = await this.http.post('/issuing', payload, { headers: this.getSecretHeaders() })
    

    const data = this.unwrap<MapleradCard>(res);

    return data;
  }

  

  async withdrawFromCard(cardId: string, amount: number, currency: Currency = 'USD'): Promise<any> {
    const card = await this.cardRepo.findOne({ where: { id: cardId }, relations: ['wallet'] });
    if (!card?.wallet) throw new Error('Card not found');

    const providerCardId = card.mapleradCardId || card.id;
    const scaled = Math.round(amount * 100);
    const res: AxiosResponse = await this.http.post(`/issuing/${providerCardId}/withdraw`, { amount: scaled }, { headers: this.getSecretHeaders() })
    

    const data = this.unwrap(res);

    return data;
  }

  async freezeCard(cardId: string): Promise<any> {
    const res: AxiosResponse = await this.http.patch(`/issuing/${cardId}/freeze`, {}, { headers: this.getSecretHeaders() })
    
    return res.data ?? res;
  }

  async unfreezeCard(cardId: string): Promise<any> {
    const res: AxiosResponse = await this.http.patch(`/issuing/${cardId}/unfreeze`, {}, { headers: this.getSecretHeaders() })
    
    return res.data ?? res;
  }

  /** -------------------------------
   * BANKS / FX
   * ------------------------------- */
  async listBanks(country = 'NG', type = 'NUBAN', page = 1, pageSize = 100): Promise<any[]> {
    const res: AxiosResponse = await this.http.get('/institutions', {
        params: { country, type, page, page_size: pageSize },
        headers: this.getSecretHeaders(),
      })
    
    return res.data?.data ?? [];
  }

  async getBankCode(bankName: string, country = 'NG'): Promise<string> {
    const banks = await this.listBanks(country);
    const bank = banks.find((b: any) => String(b.name).toLowerCase().includes(bankName.toLowerCase()));
    if (!bank) throw new Error(`Bank not found: ${bankName}`);
    return bank.code;
  }

  async getTransactions(customerId: string): Promise<any[]> {
    const res: AxiosResponse = await this.http.get('/transactions', { params: { customer_id: customerId }, headers: this.getSecretHeaders() })
    
    return res.data?.data ?? [];
  }

  async getTransactionById(id: string): Promise<any> {
    const res: AxiosResponse = await this.http.get(`/transactions/${id}`, { headers: this.getSecretHeaders() })
    
    return res.data?.data ?? res.data;
  }

  async getProviderTransactionStatus(reference: string): Promise<any | null> {
    if (!reference) return null;
    try {
      return await this.getTransactionById(reference);
    } catch (err: any) {
      logger.warn('maplerad_transaction_status_unavailable', { providerReference: reference });
      return null;
    }
  }

  /** -------------------------------
   * WEBHOOK
   * ------------------------------- */
  verifyWebhookSignature(headersOrSignature: MapleradWebhookHeaders | string, body: string): boolean {
    if (!this.webhookSecret) throw new Error('Missing MAPLERAD_WEBHOOK_SECRET');
    if (typeof headersOrSignature === 'string') return false;

    const { svixId, svixTimestamp, svixSignature } = headersOrSignature;
    if (!svixId || !svixTimestamp || !svixSignature) return false;

    const timestamp = Number(svixTimestamp);
    if (!Number.isFinite(timestamp)) return false;
    const toleranceSeconds = Number(process.env.MAPLERAD_WEBHOOK_TOLERANCE_SECONDS || 300);
    if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) return false;

    const secret = this.webhookSecret.startsWith('whsec_') ? this.webhookSecret.split('_')[1] : this.webhookSecret;
    const secretBytes = Buffer.from(secret, 'base64');
    const signedContent = `${svixId}.${svixTimestamp}.${body}`;
    const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
    const expectedBuffer = Buffer.from(expected);

    return svixSignature.split(' ').some((entry) => {
      const signature = entry.includes(',') ? entry.split(',')[1] : entry;
      if (!signature) return false;
      const receivedBuffer = Buffer.from(signature);
      return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
    });
  }

 async handleWebhook(rawBody: string) {
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch (err: any) {
    logger.warn('maplerad_webhook_invalid_payload');
    return;
  }

  const eventId = body?.id;
  const event = body?.event;
  const data = body?.data ?? body;
  const reference = body?.reference ?? data?.reference ?? data?.id ?? eventId;

  if (!eventId || !event) return;

  try {
    if (event === "collection.successful" || event === "collections.virtual_account.deposit") {
      const amount = Number(data?.amount ?? body?.amount) / 100;
      const currency = (data?.currency ?? body?.currency) as Currency;
      const customerId = data?.customer_id ?? body?.customer_id;

      if (!customerId || !amount || !currency) return;

      return {
        type: "DEPOSIT_RECORDED",
        amount,
        currency,
        customerId,
        reference,
        providerStatus: data?.status ?? body?.status,
        providerPayload: this.sanitizeProviderPayload(data),
        eventId,
        event,
      };
    }

    if (event === "collection.failed") {
      return { type: "COLLECTION_FAILED", event, eventId, reference, providerStatus: data?.status ?? body?.status };
    }

    /** -------------------------
     * USD ACCOUNT APPROVAL
     * ------------------------- */
    if (event === "virtual_account.request.approved") {
      const accountId = data?.id;
      const reference = data?.reference;

      if (!accountId || !reference) {
        logger.warn('maplerad_usd_account_approval_missing_reference', { eventId });
        return;
      }

      // Re-query Maplerad for verification
      const verified = await this.verifyVirtualAccount(accountId);
      if (!verified || verified.status !== "approved") {
        logger.warn('maplerad_usd_account_requery_failed', { eventId, accountId });
        return;
      }

      return {
        type: "USD_ACCOUNT_APPROVED",
        reference,
        accountId,
        customerId: verified.customer_id,
        eventId,
        event,
      };
    }

    if (event === "virtual_account.request.rejected") {
      return {
        type: "USD_ACCOUNT_REJECTED",
        reason: data?.reason ?? "Unknown",
        eventId,
        event,
      };
    }

    /** -------------------------
     * CARD EVENTS
     * ------------------------- */
    if (event.startsWith("issuing.")) {
      // Example: issing.card.funded / issuing.card.withdrawn / issuing.card.frozen
      logger.info('maplerad_card_event_received', { eventId, event });
      // optionally: update VirtualCard or Wallet balances
      return { type: "CARD_EVENT", event, data: this.sanitizeProviderPayload(data), eventId, reference };
    }

    /** -------------------------
     * TRANSFER / WITHDRAWAL EVENTS
     * ------------------------- */
    if (event.startsWith("transfer")) {
      logger.info('maplerad_transfer_event_received', { eventId, event });
      // optionally: update Transaction status
      return { type: "TRANSFER_EVENT", event, data: this.sanitizeProviderPayload(data), eventId, reference, providerStatus: data?.status ?? body?.status };
    }

    /** -------------------------
     * OTHER EVENTS
     * ------------------------- */
    logger.info('maplerad_other_event_received', { eventId, event });
    return { type: "OTHER_EVENT", event, data: this.sanitizeProviderPayload(data), eventId, reference };
  } catch (err: any) {
    logger.error('maplerad_webhook_processing_failed', err, { eventId, event });
    return;
  }
}

/** -------------------------
 * Verify Virtual Account (full URL + headers)
 * ------------------------- */
async verifyVirtualAccount(accountId: string) {
  try {
    const res: AxiosResponse = await this.http.get(
      `/collections/virtual-account/${accountId}`,
      { headers: this.getSecretHeaders() }
    );
    return res.data?.data ?? null;
  } catch (e: any) {
    logger.error('maplerad_virtual_account_verify_failed', e, { accountId });
    return null;
  }
}




  /* ---------------------------------------------
   * Get Virtual Card Transactions (non-queued)
   * --------------------------------------------- */
  async getCardTransactions(cardId: string): Promise<any[]> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
    const res: AxiosResponse = await this.http.get(
          `/issuing/${cardId}/transactions`,
          { headers: this.getSecretHeaders() }
        );

        const data = res.data?.data ?? res.data;
        if (!Array.isArray(data)) return [];

        const formatted = data.map((t: any) => ({
          id: t.id ?? t.reference ?? crypto.randomUUID(),
          cardId,
          type: t.type ?? 'card_transaction',
          amount: Number(t.amount) || 0,
          currency: t.currency ?? 'NGN',
          description: t.merchant_name ?? t.description ?? 'Card activity',
          status: t.status ?? 'completed',
          createdAt: t.created_at ?? t.createdAt ?? new Date().toISOString(),
        }));

        return formatted;
      } catch (err: any) {
        attempt++;
        const waitTime = Math.pow(2, attempt) * 300;
        logger.warn('maplerad_card_transactions_fetch_retry', { cardId, attempt });
        if (attempt >= maxRetries) throw new Error('Failed to fetch Maplerad card transactions');
        // sleep
        await new Promise((r) => setTimeout(r, waitTime));
      }
    }

    return [];
  }
}
