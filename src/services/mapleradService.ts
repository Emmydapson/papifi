// src/services/mapleradService.ts
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import crypto from 'crypto';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import { Currency, Wallet } from '../entities/Wallet';
import { Transaction } from '../entities/Transaction';
import { VirtualCard } from '../entities/virtualCard';
import { WebhookEvent } from '../entities/WebhookEvent';

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
 

  constructor() {
    this.http = axios.create();

    this.http.interceptors.response.use(
      (res) => res,
      async (err) => {
        const config = err?.config;
        if (!config) return Promise.reject(err);

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

  

  private getSecretHeaders() {
    return {
      Authorization: this.secretKey!,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private getPublicHeaders() {
    return {
      Authorization: this.publicKey!,
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
    throw new Error(`MapleRad Error: Failed to ensure customer for user ${user.id} - ${err.message}`);
  }

  const payload = { customer_id: customerId, currency };
  let data: any;
  try {
    const res: AxiosResponse = await this.http.post(`${this.baseUrl}/issuing/virtual_accounts`, payload, { headers: this.getSecretHeaders() })
    
    data = res.data?.data ?? res.data;
  } catch (err: any) {
    throw new Error(`MapleRad Error: Failed to call virtual_accounts endpoint - ${err.message}`);
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
    const scaled = Math.round(amount * 100);
    const res: AxiosResponse = await this.http.post(`${this.baseUrl}/issuing/${cardId}/fund`, { amount: scaled }, { headers: this.getSecretHeaders() })
    

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

    const res: AxiosResponse = await this.http.post(`${this.baseUrl}/issuing`, payload, { headers: this.getSecretHeaders() })
    

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

  

  async withdrawFromCard(cardId: string, amount: number, currency: Currency = 'USD'): Promise<any> {
    const scaled = Math.round(amount * 100);
    const res: AxiosResponse = await this.http.post(`${this.baseUrl}/issuing/${cardId}/withdraw`, { amount: scaled }, { headers: this.getSecretHeaders() })
    

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

  /** -------------------------------
   * WEBHOOK
   * ------------------------------- */
  verifyWebhookSignature(signature: string, body: string): boolean {
    if (!this.webhookSecret) throw new Error('Missing MAPLERAD_WEBHOOK_SECRET');
    const hash = crypto.createHmac('sha512', this.webhookSecret).update(body).digest('hex');
    return hash === signature;
  }

 async handleWebhook(rawBody: string) {
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch (err: any) {
    console.error("❌ Invalid webhook payload:", err?.message ?? err);
    return;
  }

  const eventId = body?.id; // Maplerad event ID
  const event = body?.event;
  const data = body?.data;

  if (!eventId || !event) {
    console.log("⚠️ Missing event ID or type in webhook payload, ignoring.");
    return;
  }

  console.log("📩 Maplerad Webhook received:", event);

  // Repositories
  const eventRepo = AppDataSource.getRepository(WebhookEvent);
  const userRepo = this.userRepo;
  const walletRepo = this.walletRepo;
  const txRepo = this.txRepo;

  // 🔒 Idempotency check
  const existing = await eventRepo.findOne({ where: { id: eventId } });
  if (existing) {
    console.log("⏳ Duplicate webhook ignored:", eventId);
    return;
  }

  // Record event before processing
  await eventRepo.save(eventRepo.create({ id: eventId, type: event }));

  try {
    /** -------------------------
     * DEPOSIT EVENTS
     * ------------------------- */
    if (event === "transaction.success" || event === "collections.virtual_account.deposit") {
      const amount = Number(data?.amount) / 100; // cents → units
      const currency = data?.currency;
      const customerId = data?.customer_id;

      if (!customerId || !amount || !currency) {
        console.log("⚠️ Missing fields in deposit webhook");
        return;
      }

      // find user
      const user = await userRepo.findOne({ where: { mapleradCustomerId: customerId } });
      if (!user) {
        console.log("⚠️ Deposit webhook received for unknown customer:", customerId);
        return;
      }

      // find wallet
      const wallet = await walletRepo.findOne({ where: { user: { id: user.id }, currency } });
      if (!wallet) {
        console.log("⚠️ Wallet not found for currency", currency);
        return;
      }

      const cur = this.getWalletBalance(wallet, currency);
      this.setWalletBalance(wallet, currency, cur + amount);
      await walletRepo.save(wallet);

      // store transaction
      // store transaction
await this.txRepo.save(
  this.txRepo.create({
    user, // ✅ correct
    amount,
    currency,
    type: "deposit",
    status: "success", // ✅ must match TransactionStatus
    reference: data?.reference ?? data?.id,
    description: "Deposit via Maplerad virtual account",
  })
);


      return { type: "DEPOSIT_RECORDED", amount, currency };
    }

    /** -------------------------
     * USD ACCOUNT APPROVAL
     * ------------------------- */
    if (event === "virtual_account.request.approved") {
      const accountId = data?.id;
      const reference = data?.reference;

      if (!accountId || !reference) {
        console.log("⚠️ Missing accountId or reference in USD account approval");
        return;
      }

      // Re-query Maplerad for verification
      const verified = await this.verifyVirtualAccount(accountId);
      if (!verified || verified.status !== "approved") {
        console.log("❌ Re-query verification failed for USD Account:", accountId);
        return;
      }

      return {
        type: "USD_ACCOUNT_APPROVED",
        reference,
        accountId,
        customerId: verified.customer_id,
      };
    }

    if (event === "virtual_account.request.rejected") {
      return {
        type: "USD_ACCOUNT_REJECTED",
        reason: data?.reason ?? "Unknown",
      };
    }

    /** -------------------------
     * CARD EVENTS
     * ------------------------- */
    if (event.startsWith("issuing.card")) {
      // Example: issing.card.funded / issuing.card.withdrawn / issuing.card.frozen
      console.log("💳 Card event received:", event);
      // optionally: update VirtualCard or Wallet balances
      return { type: "CARD_EVENT", event, data };
    }

    /** -------------------------
     * TRANSFER / WITHDRAWAL EVENTS
     * ------------------------- */
    if (event.startsWith("transfer")) {
      console.log("💸 Transfer event received:", event);
      // optionally: update Transaction status
      return { type: "TRANSFER_EVENT", event, data };
    }

    /** -------------------------
     * OTHER EVENTS
     * ------------------------- */
    console.log("ℹ️ Other Maplerad event:", event);
    return { type: "OTHER_EVENT", event, data };
  } catch (err: any) {
    console.error("❌ Error processing webhook:", err?.message ?? err);
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
    console.error("Error verifying virtual account:", e?.message ?? e);
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
        console.warn(`Maplerad card tx fetch failed (attempt ${attempt}):`, err?.message ?? err);
        if (attempt >= maxRetries) throw new Error('Failed to fetch Maplerad card transactions');
        // sleep
        await new Promise((r) => setTimeout(r, waitTime));
      }
    }

    return [];
  }
}
