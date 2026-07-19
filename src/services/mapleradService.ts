// src/services/mapleradService.ts
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import crypto from 'crypto';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import { Currency, Wallet } from '../entities/Wallet';
import { Transaction } from '../entities/Transaction';
import { VirtualCard } from '../entities/virtualCard';
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
    const status = error?.response?.status;
    const endpoint = this.endpointPath(error?.config?.url);
    const providerMessage = error?.response?.data?.message || error?.response?.data?.error;
    if (status) {
      return `${endpoint} returned ${status}${providerMessage ? `: ${String(providerMessage).slice(0, 160)}` : ''}`;
    }
    return error?.message || 'provider_error';
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
  async ensureMapleRadCustomer(userId: string): Promise<string> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    if (user.mapleradCustomerId) return user.mapleradCustomerId;

    const payload = {
      first_name: user.firstName,
      last_name: user.lastName,
      email: user.email,
      country: 'NG',
    };

    // queue the request
    const res: AxiosResponse<MapleradEnvelope<MapleradCustomer>> = await this.http.post(
    '/customers',
    payload,
    { headers: this.getSecretHeaders() }
  );


    const customerId = this.unwrap<MapleradCustomer>(res)?.id;
    if (!customerId) throw new Error('Failed to create MapleRad customer');

    user.mapleradCustomerId = customerId;
    await this.userRepo.save(user);

    return customerId;
  }

  async upgradeCustomerTier1(payload: unknown): Promise<any> {
    const res: AxiosResponse = await this.http.patch('/customers/upgrade/tier1', payload, { headers: this.getSecretHeaders() })
    
    return this.unwrap(res);
  }

  async verifyBvn(bvn: string): Promise<any> {
    const res: AxiosResponse = await this.http.post('/identity/bvn', { bvn }, { headers: this.getSecretHeaders() })

    return this.unwrap(res);
  }

  async listCustomers(page = 1, pageSize = 1): Promise<MapleradCustomer[]> {
    const res: AxiosResponse = await this.http.get('/customers', {
      params: { page, page_size: pageSize },
      headers: this.getSecretHeaders(),
    });
    const data: any = this.unwrap(res);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.customers)) return data.customers;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }

  /** -------------------------------
   * WALLET / DEPOSIT / WITHDRAWAL
   * ------------------------------- */
  async createVirtualAccountForUser(userId: string, currency: Currency = 'NGN'): Promise<any> {
  const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['wallets'] });
  if (!user) throw new Error(`MapleRad Error: User ${userId} not found`);

  let customerId: string;
  try {
    customerId = await this.ensureMapleRadCustomer(user.id);
  } catch (err: any) {
    throw new Error(`MapleRad Error: Failed to ensure customer for user ${user.id} - ${this.providerErrorDetails(err)}`);
  }

  const payload = { customer_id: customerId, currency, preferred_bank: process.env.MAPLERAD_NGN_PREFERRED_BANK };
  if (!payload.preferred_bank) delete (payload as Partial<typeof payload>).preferred_bank;
  let data: MapleradVirtualAccount;
  try {
    const res: AxiosResponse = await this.http.post('/collections/virtual-account', payload, { headers: this.getSecretHeaders() })
    
    data = this.unwrap<MapleradVirtualAccount>(res);
  } catch (err: any) {
    throw new Error(`MapleRad Error: Failed to call virtual account endpoint - ${this.providerErrorDetails(err)}`);
  }

  const accountNumber = data?.account_number;
  if (!accountNumber) {
    throw new Error(`MapleRad Error: Virtual account creation returned null for user ${user.id}`);
  }

  const wallet = new Wallet();
  wallet.user = user;
  wallet.mapleradAccountId = data.id || data.account_id;
  wallet.accountNumber = accountNumber;
  wallet.bankName = data.bank_name || data.bank?.name;
  wallet.currency = currency;

  try {
    await this.walletRepo.save(wallet);
  } catch (err: any) {
    throw new Error(`Database Error: Failed to save wallet for user ${user.id} - ${err.message}`);
  }

  return data;
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
