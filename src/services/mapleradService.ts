// src/services/mapleradService.ts
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import crypto from 'crypto';
import PQueue from 'p-queue';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import { Currency, Wallet } from '../entities/Wallet';
import { Transaction } from '../entities/Transaction';
import { VirtualCard } from '../entities/virtualCard';

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
  private readonly baseUrl = process.env.MAPLERAD_BASE_URL || 'https://api.maplerad.com/v1';
  private readonly secretKey = process.env.MAPLERAD_SECRET || process.env.MAPLERAD_SECRET_KEY;
  private readonly publicKey = process.env.MAPLERAD_PUBLIC || process.env.MAPLERAD_PUBLIC_KEY;
  private readonly webhookSecret = process.env.MAPLERAD_WEBHOOK_SECRET;
  private readonly signatureHeader = process.env.MAPLERAD_SIGNATURE_HEADER || 'x-maplerad-signature';

  private userRepo = AppDataSource.getRepository(User);
  private walletRepo = AppDataSource.getRepository(Wallet);
  private txRepo = AppDataSource.getRepository(Transaction);
  private cardRepo = AppDataSource.getRepository(VirtualCard);

  private http: AxiosInstance;
  private queue: PQueue;

  constructor() {
    // p-queue v9 default export is a class — import normally for types to work
    this.queue = new PQueue({ interval: 500, intervalCap: 2 });

    this.http = axios.create();
    // Basic retry interceptor - small retry on network/server errors
    this.http.interceptors.response.use(
      (res) => res,
      async (err) => {
        const config = err?.config;
        if (!config) return Promise.reject(err);
        // ensure we have retryCount
        config.retryCount = config.retryCount || 0;
        if (config.retryCount < 2) {
          config.retryCount += 1;
          return this.http(config);
        }
        return Promise.reject(err);
      }
    );
  }

  getProviderName(): string {
    return 'MapleRad';
  }

  private getSecretHeaders() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private getPublicHeaders() {
    return {
      Authorization: `Bearer ${this.publicKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  // Helper: read wallet balance field for a currency safely
  private getWalletBalance(wallet: Wallet, currency: Currency): number {
    // Wallet entity uses properties like NGN, USD, GBP (numbers).
    // cast to any to avoid TS complaining about index signature on Wallet
    const curVal = (wallet as any)[currency];
    return typeof curVal === 'number' ? Number(curVal) : Number(curVal ?? 0);
  }

  // Helper: set wallet balance safely
  private setWalletBalance(wallet: Wallet, currency: Currency, value: number) {
    (wallet as any)[currency] = Number(value);
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
    const res: AxiosResponse = await this.queue.add(() =>
      this.http.post(`${this.baseUrl}/customers`, payload, { headers: this.getSecretHeaders() })
    );

    const customerId = res.data?.data?.id ?? res.data?.id;
    if (!customerId) throw new Error('Failed to create MapleRad customer');

    user.mapleradCustomerId = customerId;
    await this.userRepo.save(user);

    return customerId;
  }

  async upgradeCustomerTier1(payload: unknown): Promise<any> {
    const res: AxiosResponse = await this.queue.add(() =>
      this.http.patch(`${this.baseUrl}/customers/upgrade/tier1`, payload, { headers: this.getSecretHeaders() })
    );
    return res.data?.data ?? res.data;
  }

  async verifyBvn(bvn: string): Promise<any> {
    const res: AxiosResponse = await this.queue.add(() =>
      this.http.post(`${this.baseUrl}/identity/bvn`, { bvn }, { headers: this.getSecretHeaders() })
    );
    return res.data?.data ?? res.data;
  }

  /** -------------------------------
   * WALLET / DEPOSIT / WITHDRAWAL
   * ------------------------------- */
  async createVirtualAccountForUser(userId: string, currency: Currency = 'NGN'): Promise<any> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['wallets'] });
    if (!user) throw new Error('User not found');

    const customerId = await this.ensureMapleRadCustomer(user.id);

    const payload = { customer_id: customerId, currency };

    const res: AxiosResponse = await this.queue.add(() =>
      this.http.post(`${this.baseUrl}/issuing/virtual_accounts`, payload, { headers: this.getSecretHeaders() })
    );

    const data = res.data?.data ?? res.data;
    if (!data?.account_number) throw new Error('Failed to create virtual account');

    // create and save wallet record
    const wallet = new Wallet();
    wallet.user = user;
    wallet.mapleradAccountId = data.id;
    wallet.accountNumber = data.account_number;
    wallet.bankName = data.bank_name;
    wallet.currency = currency;
    // balances default to 0 via entity defaults
    await this.walletRepo.save(wallet);

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

    const res: AxiosResponse = await this.queue.add(() =>
      this.http.post(`${this.baseUrl}/transfers`, payload, { headers: this.getSecretHeaders() })
    );

    const data = res.data?.data ?? res.data;

    // store transaction record
    const tx = new Transaction();
    tx.user = user;
    tx.amount = amount;
    tx.currency = currency;
    tx.type = 'withdrawal';
    tx.status = data?.status ?? 'pending';
    tx.reference = data?.reference ?? data?.id ?? undefined;
    tx.description = description ?? 'Wallet withdrawal';
    await this.txRepo.save(tx);

    // update user's wallet (pick wallet with matching currency)
    const wallet = await this.walletRepo.findOne({ where: { user: { id: user.id }, currency } });
    if (wallet) {
      const currBalance = this.getWalletBalance(wallet, currency);
      this.setWalletBalance(wallet, currency, currBalance - amount);
      await this.walletRepo.save(wallet);
    }

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

    const res: AxiosResponse = await this.queue.add(() =>
      this.http.post(`${this.baseUrl}/issuing`, payload, { headers: this.getSecretHeaders() })
    );

    const data = res.data?.data ?? res.data;

    // Save virtual card entity
    const card = new VirtualCard();
    card.wallet = wallet;
    card.cardNumber = data?.card_number ?? data?.cardNumber ?? undefined;
    card.cvv = data?.cvv ?? data?.cvvCode ?? undefined;
    card.expirationDate = data?.expiry ?? data?.expiration ?? undefined;
    // other fields if available...
    await this.cardRepo.save(card);

    return data;
  }

  async fundCard(cardId: string, amount: number, currency: Currency = 'USD'): Promise<any> {
    const scaled = Math.round(amount * 100);
    const res: AxiosResponse = await this.queue.add(() =>
      this.http.post(`${this.baseUrl}/issuing/${cardId}/fund`, { amount: scaled }, { headers: this.getSecretHeaders() })
    );

    const data = res.data?.data ?? res.data;

    // Update underlying wallet (if card -> wallet relation exists)
    const card = await this.cardRepo.findOne({ where: { id: cardId }, relations: ['wallet'] });
    if (card && card.wallet) {
      const wallet = await this.walletRepo.findOne({ where: { id: card.wallet.id } });
      if (wallet) {
        const curr = this.getWalletBalance(wallet, currency);
        this.setWalletBalance(wallet, currency, curr - amount);
        await this.walletRepo.save(wallet);
      }
    }

    return data;
  }

  async withdrawFromCard(cardId: string, amount: number, currency: Currency = 'USD'): Promise<any> {
    const scaled = Math.round(amount * 100);
    const res: AxiosResponse = await this.queue.add(() =>
      this.http.post(`${this.baseUrl}/issuing/${cardId}/withdraw`, { amount: scaled }, { headers: this.getSecretHeaders() })
    );

    const data = res.data?.data ?? res.data;

    // Update underlying wallet
    const card = await this.cardRepo.findOne({ where: { id: cardId }, relations: ['wallet'] });
    if (card && card.wallet) {
      const wallet = await this.walletRepo.findOne({ where: { id: card.wallet.id } });
      if (wallet) {
        const curr = this.getWalletBalance(wallet, currency);
        this.setWalletBalance(wallet, currency, curr - amount);
        await this.walletRepo.save(wallet);
      }
    }

    return data;
  }

  async freezeCard(cardId: string): Promise<any> {
    const res: AxiosResponse = await this.queue.add(() =>
      this.http.patch(`${this.baseUrl}/issuing/${cardId}/freeze`, {}, { headers: this.getSecretHeaders() })
    );
    return res.data ?? res;
  }

  async unfreezeCard(cardId: string): Promise<any> {
    const res: AxiosResponse = await this.queue.add(() =>
      this.http.patch(`${this.baseUrl}/issuing/${cardId}/unfreeze`, {}, { headers: this.getSecretHeaders() })
    );
    return res.data ?? res;
  }

  /** -------------------------------
   * BANKS / FX
   * ------------------------------- */
  async listBanks(country = 'NG', type = 'NUBAN', page = 1, pageSize = 100): Promise<any[]> {
    const res: AxiosResponse = await this.queue.add(() =>
      this.http.get(`${this.baseUrl}/institutions`, {
        params: { country, type, page, page_size: pageSize },
        headers: this.getSecretHeaders(),
      })
    );
    return res.data?.data ?? [];
  }

  async getBankCode(bankName: string, country = 'NG'): Promise<string> {
    const banks = await this.listBanks(country);
    const bank = banks.find((b: any) => String(b.name).toLowerCase().includes(bankName.toLowerCase()));
    if (!bank) throw new Error(`Bank not found: ${bankName}`);
    return bank.code;
  }

  async getTransactions(customerId: string): Promise<any[]> {
    const res: AxiosResponse = await this.queue.add(() =>
      this.http.get(`${this.baseUrl}/transactions?customer_id=${customerId}`, { headers: this.getSecretHeaders() })
    );
    return res.data?.data ?? [];
  }

  async getTransactionById(id: string): Promise<any> {
    const res: AxiosResponse = await this.queue.add(() =>
      this.http.get(`${this.baseUrl}/transactions/${id}`, { headers: this.getSecretHeaders() })
    );
    return res.data?.data ?? res.data;
  }

  /** -------------------------------
   * WEBHOOK
   * ------------------------------- */
  verifyWebhookSignature(signature: string, body: string): boolean {
    if (!this.webhookSecret) throw new Error('Missing MAPLERAD_WEBHOOK_SECRET');
    const hash = crypto.createHmac('sha512', this.webhookSecret).update(body).digest('hex');
    return hash === signature;
  }

  async handleWebhook(rawBody: string): Promise<{ type: string; userId: string; customerId: string } | any> {
    const event = JSON.parse(rawBody);
    const eventType = event?.type ?? event?.event_type;
    const data = event?.data ?? event?.payload ?? {};

    // Map possible variations in customer id key names
    const customerId = data?.customerId ?? data?.customer_id ?? data?.id ?? data?.customer;

    console.log('MapleRad webhook received:', eventType, data);

    if (!customerId) {
      // If no customer id in payload, return the raw event for manual handling
      return { type: eventType, raw: event };
    }

    const user = await this.userRepo.findOne({ where: { mapleradCustomerId: customerId } });
    if (!user) throw new Error('User not found for MapleRad customer');

    // further event-specific handling may be added here...

    return { type: eventType, userId: user.id, customerId };
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
        console.warn(`Maplerad card tx fetch failed (attempt ${attempt}):`, err?.message ?? err);
        if (attempt >= maxRetries) throw new Error('Failed to fetch Maplerad card transactions');
        // sleep
        await new Promise((r) => setTimeout(r, waitTime));
      }
    }

    return [];
  }
}
