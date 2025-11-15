import axios, { AxiosInstance, AxiosResponse } from 'axios';
import crypto from 'crypto';
import PQueue from 'p-queue';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import { Currency, Wallet } from '../entities/Wallet';
import { Transaction } from '../entities/Transaction';
import { VirtualCard } from '../entities/virtualCard';

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
    // Rate limiter queue: max 2 requests per 500ms
    this.queue = new PQueue({ interval: 500, intervalCap: 2 });

    this.http = axios.create();
    this.http.interceptors.response.use(
      res => res,
      async err => {
        const config = err.config;
        if (!config || !config.retryCount) config.retryCount = 0;
        if (config.retryCount < 2) {
          config.retryCount += 1;
          return this.http(config);
        }
        return Promise.reject(err);
      }
    );
  }

  getProviderName() { return 'MapleRad'; }

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

  /** -------------------------------
   * CUSTOMER MANAGEMENT
   * -------------------------------
   */
  async ensureMapleRadCustomer(userId: string): Promise<string> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    if (user.mapleradCustomerId) return user.mapleradCustomerId;

    // Tier 0 customer creation
    const payload = { first_name: user.firstName, last_name: user.lastName, email: user.email, country: 'NG' };
    const res = await this.queue.add<AxiosResponse>(() =>
  this.http.post(`${this.baseUrl}/customers`, payload, { headers: this.getSecretHeaders() })
);

    const customerId = res.data?.data?.id;
    if (!customerId) throw new Error('Failed to create MapleRad customer');

    user.mapleradCustomerId = customerId;
    await this.userRepo.save(user);
    return customerId;
  }

  async upgradeCustomerTier1(payload: any) {
    const res = await this.queue.add<AxiosResponse>(() =>
  this.http.patch(`${this.baseUrl}/customers/upgrade/tier1`, payload, { headers: this.getSecretHeaders() })
);

    return res.data?.data || res.data;
  }

  async verifyBvn(bvn: string) {
    const res = await this.queue.add<AxiosResponse>(() =>
  this.http.post(`${this.baseUrl}/identity/bvn`, { bvn }, { headers: this.getSecretHeaders() })
);

    return res.data?.data;
  }

  /** -------------------------------
   * WALLET / DEPOSIT / WITHDRAWAL
   * -------------------------------
   */
  async createVirtualAccountForUser(userId: string, currency: 'NGN' | 'USD' | 'GBP' = 'NGN')
 {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['wallets'] });
    if (!user) throw new Error('User not found');

    const customerId = await this.ensureMapleRadCustomer(user.id);
    const payload = { customer_id: customerId, currency };

    const res = await this.queue.add<AxiosResponse>(() =>
  this.http.post(`${this.baseUrl}/issuing/virtual_accounts`, payload, { headers: this.getSecretHeaders() })
);

    const data = res.data?.data || res.data;

    if (!data?.account_number) throw new Error('Failed to create virtual account');

    // Save to Wallet
    const wallet = new Wallet();
    wallet.user = user;
    wallet.mapleradAccountId = data.id;
    wallet.accountNumber = data.account_number;
    wallet.bankName = data.bank_name;
    wallet.currency = currency;
    await this.walletRepo.save(wallet);

    return data;
  }

  async createWithdrawal(
  userId: string,
  amount: number,
  currency: Currency,
  destination: { bankCode: string; accountNumber: string; accountName?: string },
  description?: string
) {
  const user = await this.userRepo.findOne({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  const customerId = await this.ensureMapleRadCustomer(user.id);
  const payload = {
    customer_id: customerId,
    amount,
    currency,
    reason: description || 'Wallet withdrawal',
    destination: {
      type: 'bank_account',
      bank_code: destination.bankCode,
      account_number: destination.accountNumber,
      name: destination.accountName || `${user.firstName} ${user.lastName}`,
    },
  };

  const res = await this.queue.add<AxiosResponse>(() =>
  this.http.post(`${this.baseUrl}/transfers`, payload, { headers: this.getSecretHeaders() })
);

  const data = res.data?.data || res.data;

  // Save transaction
  const tx = new Transaction();
  tx.user = user;
  tx.amount = amount;
  tx.currency = currency;
  tx.type = 'withdrawal';
  tx.status = data.status || 'pending';
  tx.reference = data.reference || data.id;
  tx.description = description || 'Wallet withdrawal';
  await this.txRepo.save(tx);

  // Update wallet balance
  const wallet = await this.walletRepo.findOne({ where: { user: { id: user.id }, currency } });
  if (wallet) {
    wallet[currency] = Number(wallet[currency]) - amount;
    await this.walletRepo.save(wallet);
  }

  return data;
}


  /** -------------------------------
   * VIRTUAL CARDS
   * -------------------------------
   */
  async createVirtualCard(userId: string, currency = 'USD', brand = 'VISA', amount?: number) {
    const customerId = await this.ensureMapleRadCustomer(userId);
    const payload: any = { customer_id: customerId, currency, type: 'VIRTUAL', auto_approve: true, brand };
    if (amount) payload.amount = amount * 100;

    const res = await this.queue.add<AxiosResponse>(() => this.http.post(`${this.baseUrl}/issuing`, payload, { headers: this.getSecretHeaders() }));
    const data = res.data?.data || res.data;

    // Save virtual card
    const card = new VirtualCard();
    card.wallet.id = userId;
    card.cardNumber = data.card_number;
    card.cvv = data.cvv;
    card.expirationDate = data.expiry;
    await this.cardRepo.save(card);

    return data;
  }

  async fundCard(cardId: string, amount: number, currency: Currency = 'USD') {
  const scaledAmount = amount * 100;
  const res = await this.queue.add<AxiosResponse>(() =>
  this.http.post(`${this.baseUrl}/issuing/${cardId}/fund`, { amount: scaledAmount }, { headers: this.getSecretHeaders() })
);


  // Update wallet
  const card = await this.cardRepo.findOne({ where: { id: cardId }, relations: ['wallet'] });
  if (card) {
    const wallet = await this.walletRepo.findOne({ where: { id: card.wallet.id } });
    if (wallet) {
      wallet[currency] = Number(wallet[currency]) - amount;
      await this.walletRepo.save(wallet);
    }
  }

  return res.data;
}


  async withdrawFromCard(cardId: string, amount: number, currency: Currency = 'USD') {
  const scaledAmount = amount * 100;
  const res = await this.queue.add<AxiosResponse>(() =>
  this.http.post(`${this.baseUrl}/issuing/${cardId}/withdraw`, { amount: scaledAmount }, { headers: this.getSecretHeaders() })
);


  // Update wallet
  const card = await this.cardRepo.findOne({ where: { id: cardId }, relations: ['wallet'] });
  if (card) {
    const wallet = await this.walletRepo.findOne({ where: { id: card.wallet.id } });
    if (wallet) {
      wallet[currency] = Number(wallet[currency]) - amount;
      await this.walletRepo.save(wallet);
    }
  }

  return res.data;
}

  async freezeCard(cardId: string) {
    const res = await this.queue.add<AxiosResponse>(() => this.http.patch(`${this.baseUrl}/issuing/${cardId}/freeze`, {}, { headers: this.getSecretHeaders() }));
    return res.data;
  }

  async unfreezeCard(cardId: string) {
    const res = await this.queue.add<AxiosResponse>(() => this.http.patch(`${this.baseUrl}/issuing/${cardId}/unfreeze`, {}, { headers: this.getSecretHeaders() }));
    return res.data;
  }

  /** -------------------------------
   * BANKS / FX
   * -------------------------------
   */
  async getBankCode(bankName: string, country = 'NG'): Promise<string> {
    const banks = await this.listBanks(country);
    const bank = banks.find((b: any) => b.name.toLowerCase().includes(bankName.toLowerCase()));
    if (!bank) throw new Error(`Bank not found: ${bankName}`);
    return bank.code;
  }

  async listBanks(country = 'NG', type = 'NUBAN', page = 1, pageSize = 100): Promise<any[]> {
    const res = await this.queue.add<AxiosResponse>(() =>
  this.http.get(`${this.baseUrl}/institutions`, {
    params: { country, type, page, page_size: pageSize },
    headers: this.getSecretHeaders()
  })
);

    return res.data?.data || [];
  }

  async getTransactions(customerId: string) {
    const res = await this.queue.add<AxiosResponse>(() =>
  this.http.get(`${this.baseUrl}/transactions?customer_id=${customerId}`, { headers: this.getSecretHeaders() })
);

    return res.data?.data || [];
  }

  async getTransactionById(id: string) {
    const res = await this.queue.add<AxiosResponse>(() =>
  this.http.get(`${this.baseUrl}/transactions/${id}`, { headers: this.getSecretHeaders() })
);

  }

  /** -------------------------------
   * WEBHOOK
   * -------------------------------
   */
  verifyWebhookSignature(signature: string, body: string) {
    if (!this.webhookSecret) throw new Error('Missing MAPLERAD_WEBHOOK_SECRET');
    const hash = crypto.createHmac('sha512', this.webhookSecret).update(body).digest('hex');
    return hash === signature;
  }

  async handleWebhook(rawBody: string) {
    const event = JSON.parse(rawBody);
    const eventType = event?.type;
    const data = event?.data;

    console.log('MapleRad webhook received:', eventType, data);
    // handle specific events here

    const user = await this.userRepo.findOne({ where: { mapleradCustomerId: data.customerId } });
    if (!user) throw new Error('User not found for MapleRad customer');

    return { type: eventType, userId: user.id, customerId: data.customerId };
  }

  /* ---------------------------------------------
 * Get Virtual Card Transactions
 * --------------------------------------------- */
async getCardTransactions(cardId: string): Promise<any[]> {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      // Call Maplerad endpoint for card transactions
      const res = await axios.get(
        `${this.baseUrl}/issuing/cards/${cardId}/transactions`,
        { headers: this.getSecretHeaders() }
      );

      const data = res.data?.data || res.data;
      if (!Array.isArray(data)) return [];

      // Normalize transaction structure
      const formatted = data.map((t: any) => ({
        id: t.id || t.reference || crypto.randomUUID(),
        cardId,
        type: t.type || 'card_transaction',
        amount: Number(t.amount) || 0,
        currency: t.currency || 'NGN',
        description: t.merchant_name || t.description || 'Card activity',
        status: t.status || 'completed',
        createdAt: t.created_at || new Date().toISOString(),
      }));

      return formatted;
    } catch (err: any) {
      attempt++;
      const waitTime = Math.pow(2, attempt) * 300; // exponential backoff
      console.warn(
        `Maplerad card tx fetch failed (attempt ${attempt}):`,
        err?.message
      );
      if (attempt >= maxRetries)
        throw new Error('Failed to fetch Maplerad card transactions');
      await new Promise((res) => setTimeout(res, waitTime));
    }
  }

  return [];
}

}
