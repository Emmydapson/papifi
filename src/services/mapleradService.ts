// src/services/mapleradService.ts
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import crypto from 'crypto';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import { Currency, Wallet } from '../entities/Wallet';
import { Transaction } from '../entities/Transaction';
import { VirtualCard } from '../entities/virtualCard';
import { logger } from './logger';

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
  private readonly signatureHeader = process.env.MAPLERAD_SIGNATURE_HEADER || 'x-maplerad-signature';

  private userRepo = AppDataSource.getRepository(User);
  private walletRepo = AppDataSource.getRepository(Wallet);
  private txRepo = AppDataSource.getRepository(Transaction);
  private cardRepo = AppDataSource.getRepository(VirtualCard);

  private http: AxiosInstance;
 

  constructor() {
    this.http = axios.create();

    this.http.interceptors.response.use(
      (res) => res,
      async (err) => {
        const config = err?.config;
        if (!config) return Promise.reject(err);

        if (err?.response?.status) {
          logger.warn('maplerad_provider_request_failed', {
            method: String(config.method || 'GET').toUpperCase(),
            endpoint: this.endpointPath(config.url),
            status: err.response.status,
          });
        }

        config.retryCount = config.retryCount || 0;

        if (config.retryCount < 2) {
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

  private providerErrorDetails(error: any) {
    const status = error?.response?.status;
    const endpoint = this.endpointPath(error?.config?.url);
    if (status) return `${endpoint} returned ${status}`;
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
    const res: AxiosResponse = await this.http.post(
    `${this.baseUrl}/customers`,
    payload,
    { headers: this.getSecretHeaders() }
  );


    const customerId = res.data?.data?.id ?? res.data?.id;
    if (!customerId) throw new Error('Failed to create MapleRad customer');

    user.mapleradCustomerId = customerId;
    await this.userRepo.save(user);

    return customerId;
  }

  async upgradeCustomerTier1(payload: unknown): Promise<any> {
    const res: AxiosResponse = await this.http.patch(`${this.baseUrl}/customers/upgrade/tier1`, payload, { headers: this.getSecretHeaders() })
    
    return res.data?.data ?? res.data;
  }

  async verifyBvn(bvn: string): Promise<any> {
    const res: AxiosResponse = await this.http.post(`${this.baseUrl}/identity/bvn`, { bvn }, { headers: this.getSecretHeaders() })

    return res.data?.data ?? res.data;
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

  const payload = { customer_id: customerId, currency };
  let data: any;
  try {
    const res: AxiosResponse = await this.http.post(`${this.baseUrl}/issuing/virtual_accounts`, payload, { headers: this.getSecretHeaders() })
    
    data = res.data?.data ?? res.data;
  } catch (err: any) {
    throw new Error(`MapleRad Error: Failed to call virtual_accounts endpoint - ${this.providerErrorDetails(err)}`);
  }

  if (!data?.account_number) {
    throw new Error(`MapleRad Error: Virtual account creation returned null for user ${user.id}`);
  }

  const wallet = new Wallet();
  wallet.user = user;
  wallet.mapleradAccountId = data.id;
  wallet.accountNumber = data.account_number;
  wallet.bankName = data.bank_name;
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
      `${this.baseUrl}/collections/virtual-account/usd`,
      payload,
      { headers: this.getSecretHeaders() }
    )
  

  const data = res.data?.data ?? res.data;

  // data.reference means "account creation request started"
  if (!data?.reference) {
    throw new Error('USD account request did not return a reference');
  }

  return data;
}

async getUsdAccountRails(accountId: string): Promise<any> {
  if (!accountId) throw new Error('USD Account ID is required');

  const res: AxiosResponse = await this.http.get(
      `${this.baseUrl}/collections/virtual-account/${accountId}/rails`,
      { headers: this.getSecretHeaders() }
    )
  

  return res.data?.data ?? res.data;
}

async getUsdVirtualAccountById(id: string): Promise<any> {
  if (!id) throw new Error('USD Virtual Account ID is required');

  const res: AxiosResponse = await this.http.get(
      `${this.baseUrl}/collections/virtual-account/${id}`,
      { headers: this.getSecretHeaders() }
    )
  

  return res.data?.data ?? res.data;
}

async checkUsdAccountRequestStatus(reference: string): Promise<any> {
  if (!reference) throw new Error('USD account reference is required');

  const res: AxiosResponse = await this.http.get(
      `${this.baseUrl}/collections/virtual-account/status/${reference}`,
      { headers: this.getSecretHeaders() }
    )
  

  return res.data?.data ?? res.data;
}


  async fundCard(cardId: string, amount: number, currency: Currency = 'USD'): Promise<any> {
    const card = await this.cardRepo.findOne({ where: { id: cardId }, relations: ['wallet'] });
    if (!card?.wallet) throw new Error('Card not found');

    const providerCardId = card.mapleradCardId || card.id;
    const scaled = Math.round(amount * 100);
    const res: AxiosResponse = await this.http.post(`${this.baseUrl}/issuing/${providerCardId}/fund`, { amount: scaled }, { headers: this.getSecretHeaders() })
    

    const data = res.data?.data ?? res.data;

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
      customer_id: customerId,
      amount,
      currency,
      reason: description ?? 'Wallet withdrawal',
      destination: {
        type: 'bank_account',
        bank_code: destination.bankCode,
        account_number: destination.accountNumber,
        name: destination.accountName ?? `${user.firstName} ${user.lastName}`,
      },
    };

    const res: AxiosResponse = await this.http.post(`${this.baseUrl}/transfers`, payload, { headers: this.getSecretHeaders() })
    

    const data = res.data?.data ?? res.data;

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

    const res: AxiosResponse = await this.http.post(`${this.baseUrl}/issuing`, payload, { headers: this.getSecretHeaders() })
    

    const data = res.data?.data ?? res.data;

    return data;
  }

  

  async withdrawFromCard(cardId: string, amount: number, currency: Currency = 'USD'): Promise<any> {
    const card = await this.cardRepo.findOne({ where: { id: cardId }, relations: ['wallet'] });
    if (!card?.wallet) throw new Error('Card not found');

    const providerCardId = card.mapleradCardId || card.id;
    const scaled = Math.round(amount * 100);
    const res: AxiosResponse = await this.http.post(`${this.baseUrl}/issuing/${providerCardId}/withdraw`, { amount: scaled }, { headers: this.getSecretHeaders() })
    

    const data = res.data?.data ?? res.data;

    return data;
  }

  async freezeCard(cardId: string): Promise<any> {
    const res: AxiosResponse = await this.http.patch(`${this.baseUrl}/issuing/${cardId}/freeze`, {}, { headers: this.getSecretHeaders() })
    
    return res.data ?? res;
  }

  async unfreezeCard(cardId: string): Promise<any> {
    const res: AxiosResponse = await this.http.patch(`${this.baseUrl}/issuing/${cardId}/unfreeze`, {}, { headers: this.getSecretHeaders() })
    
    return res.data ?? res;
  }

  /** -------------------------------
   * BANKS / FX
   * ------------------------------- */
  async listBanks(country = 'NG', type = 'NUBAN', page = 1, pageSize = 100): Promise<any[]> {
    const res: AxiosResponse = await this.http.get(`${this.baseUrl}/institutions`, {
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
    const res: AxiosResponse = await this.http.get(`${this.baseUrl}/transactions?customer_id=${customerId}`, { headers: this.getSecretHeaders() })
    
    return res.data?.data ?? [];
  }

  async getTransactionById(id: string): Promise<any> {
    const res: AxiosResponse = await this.http.get(`${this.baseUrl}/transactions/${id}`, { headers: this.getSecretHeaders() })
    
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
  verifyWebhookSignature(signature: string, body: string): boolean {
    if (!this.webhookSecret) throw new Error('Missing MAPLERAD_WEBHOOK_SECRET');
    const hash = crypto.createHmac('sha512', this.webhookSecret).update(body).digest('hex');
    const received = Buffer.from(signature, 'hex');
    const expected = Buffer.from(hash, 'hex');
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
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
  const data = body?.data;
  const reference = data?.reference ?? data?.id ?? eventId;

  if (!eventId || !event) return;

  try {
    if (event === "transaction.success" || event === "collections.virtual_account.deposit") {
      const amount = Number(data?.amount) / 100;
      const currency = data?.currency;
      const customerId = data?.customer_id;

      if (!customerId || !amount || !currency) return;

      return {
        type: "DEPOSIT_RECORDED",
        amount,
        currency,
        customerId,
        reference,
        providerStatus: data?.status,
        providerPayload: data,
        eventId,
        event,
      };
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
    if (event.startsWith("issuing.card")) {
      // Example: issing.card.funded / issuing.card.withdrawn / issuing.card.frozen
      logger.info('maplerad_card_event_received', { eventId, event });
      // optionally: update VirtualCard or Wallet balances
      return { type: "CARD_EVENT", event, data, eventId, reference };
    }

    /** -------------------------
     * TRANSFER / WITHDRAWAL EVENTS
     * ------------------------- */
    if (event.startsWith("transfer")) {
      logger.info('maplerad_transfer_event_received', { eventId, event });
      // optionally: update Transaction status
      return { type: "TRANSFER_EVENT", event, data, eventId, reference };
    }

    /** -------------------------
     * OTHER EVENTS
     * ------------------------- */
    logger.info('maplerad_other_event_received', { eventId, event });
    return { type: "OTHER_EVENT", event, data, eventId, reference };
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
      `${this.baseUrl}/collections/virtual-account/${accountId}`,
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
          `${this.baseUrl}/issuing/cards/${cardId}/transactions`,
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
