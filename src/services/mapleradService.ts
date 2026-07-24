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
import { ProviderReference } from '../entities/ProviderReference';
import { logger } from './logger';
import { resolveMapleradConfig, ResolvedMapleradConfig } from '../config/maplerad';

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

export type MapleradProviderErrorCode =
  | 'VALIDATION'
  | 'AUTH'
  | 'NOT_FOUND'
  | 'RATE_LIMIT'
  | 'ACCOUNT'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'PROVIDER'
  | 'SCHEMA';

export type MapleradApplicationErrorCode =
  | 'BVN_NOT_VERIFIED'
  | 'BVN_INVALID'
  | 'BVN_IDENTITY_MISMATCH'
  | 'BVN_REVIEW_REQUIRED'
  | 'MAPLERAD_INSUFFICIENT_BALANCE'
  | 'MAPLERAD_AUTHENTICATION_FAILED'
  | 'MAPLERAD_CONFIGURATION_ERROR'
  | 'MAPLERAD_VALIDATION_ERROR'
  | 'MAPLERAD_CONTRACT_ERROR'
  | 'MAPLERAD_RATE_LIMITED'
  | 'MAPLERAD_UNAVAILABLE';

export type MapleradBvnVerificationResult = {
  verified: boolean;
  provider: 'maplerad';
  providerEnvironment: 'sandbox' | 'production';
  applicationCode: 'BVN_VERIFIED' | 'BVN_NOT_VERIFIED';
  providerHttpStatus?: number;
  providerRequestId?: string;
  providerStatus?: boolean;
  providerCode?: unknown;
  providerMessage?: string;
  identity?: {
    firstName?: string;
    middleName?: string;
    lastName?: string;
    dateOfBirth?: string;
    phoneNumber?: string;
    gender?: string;
    image?: string;
  };
  responseKeys: string[];
  dataKeys: string[];
};

export class MapleradProviderError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly providerStatus?: number,
    public readonly providerMessage?: string,
    public readonly requestId?: string,
    public readonly safeResponseBody?: unknown,
    public readonly code: MapleradProviderErrorCode = 'PROVIDER'
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
  if (error.code === 'RATE_LIMIT') return 429;
  if (error.code === 'ACCOUNT') return 503;
  if (error.code === 'SCHEMA') return 502;
  return 502;
};

export const mapleradErrorToApplicationCode = (error: unknown): MapleradApplicationErrorCode => {
  if (!isMapleradProviderError(error)) return 'MAPLERAD_UNAVAILABLE';
  const message = String(error.providerMessage || '').toLowerCase();
  if (error.code === 'ACCOUNT' || message.includes('insufficient balance')) return 'MAPLERAD_INSUFFICIENT_BALANCE';
  if (error.code === 'AUTH') {
    return error.providerStatus === 403 ? 'MAPLERAD_CONFIGURATION_ERROR' : 'MAPLERAD_AUTHENTICATION_FAILED';
  }
  if (error.code === 'VALIDATION' || error.code === 'NOT_FOUND') return 'MAPLERAD_VALIDATION_ERROR';
  if (error.code === 'RATE_LIMIT') return 'MAPLERAD_RATE_LIMITED';
  if (error.code === 'SCHEMA') return 'MAPLERAD_CONTRACT_ERROR';
  return 'MAPLERAD_UNAVAILABLE';
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

export type MapleradWebhookVerificationResult =
  | { ok: true; mode: 'signature' | 'ip_and_requery' | 'disabled'; warning?: string }
  | { ok: false; status: number; message: string; mode: 'signature' | 'ip_and_requery' | 'disabled' };

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
  private readonly config: ResolvedMapleradConfig = resolveMapleradConfig();
  private readonly baseUrl = this.config.baseUrl;
  private readonly environment = this.config.environment;
  private readonly secretKey = this.config.secretKey;
  private readonly publicKey = this.config.publicKey;
  private readonly webhookSecret = this.config.webhookSecret;
  private readonly previousWebhookSecret = this.config.previousWebhookSecret;
  private readonly webhookVerificationMode = this.config.webhookVerificationMode;

  private userRepo = AppDataSource.getRepository(User);
  private walletRepo = AppDataSource.getRepository(Wallet);
  private txRepo = AppDataSource.getRepository(Transaction);
  private cardRepo = AppDataSource.getRepository(VirtualCard);
  private providerReferenceRepo = AppDataSource.getRepository(ProviderReference);

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

  getEnvironment() {
    return this.environment;
  }

  getWebhookVerificationMode() {
    return this.webhookVerificationMode;
  }

  getWebhookConfigSummary() {
    return {
      mode: this.webhookVerificationMode,
      secretConfigured: this.config.webhookSecretConfigured,
      secretFormatValid: this.config.webhookSecretFormatValid,
    };
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
    const value = body?.message || body?.error || body?.errors?.[0]?.message || body?.detail || body?.data?.message;
    return value ? String(value).slice(0, 240) : undefined;
  }

  private providerErrorCode(status?: number, message?: string, axiosCode?: string): MapleradProviderErrorCode {
    const lower = String(message || '').toLowerCase();
    if (axiosCode === 'ECONNABORTED') return 'TIMEOUT';
    if (!status) return 'NETWORK';
    if (
      lower.includes('insufficient balance') ||
      lower.includes('account not funded') ||
      lower.includes('service not enabled')
    ) {
      return 'ACCOUNT';
    }
    if (status === 401 || status === 403) return 'AUTH';
    if (status === 404) return 'NOT_FOUND';
    if (status === 429) return 'RATE_LIMIT';
    if (status === 400 || status === 422) return 'VALIDATION';
    if (lower.includes('validation')) return 'VALIDATION';
    return 'PROVIDER';
  }

  private async requestMapleradRaw<T>(options: MapleradRequestOptions): Promise<AxiosResponse<MapleradEnvelope<T> | T>> {
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
      return res;
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

  private async requestMaplerad<T>(options: MapleradRequestOptions): Promise<T> {
    return this.unwrap<T>(await this.requestMapleradRaw<T>(options));
  }

  private normalize(value?: string | null) {
    return String(value || '').trim().toLowerCase();
  }

  private normalizeName(value?: string | null) {
    return this.normalizeIdentityName(value);
  }

  private validateCustomerMatch(user: User, customer: MapleradCustomer) {
    const mismatches: string[] = [];
    if (customer.email && this.normalize(customer.email) !== this.normalize(user.email)) mismatches.push('email');
    if (customer.first_name && this.normalizeName(customer.first_name) !== this.normalizeName(user.firstName)) mismatches.push('first_name');
    if (customer.last_name && this.normalizeName(customer.last_name) !== this.normalizeName(user.lastName)) mismatches.push('last_name');
    return { ok: mismatches.length === 0, mismatches };
  }

  private lockUser(manager: EntityManager, userId: string) {
    return manager
      .getRepository(User)
      .createQueryBuilder('user')
      .where('user.id = :userId', { userId })
      .setLock('pessimistic_write')
      .getOne();
  }

  private providerReferenceWhere(userId: string) {
    return {
      userId,
      provider: 'maplerad',
      providerEnvironment: this.environment,
      referenceType: 'customer',
    };
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
    const user = await this.lockUser(manager, userId);
    if (!user) throw new Error('User not found');

    let reference = await manager.getRepository(ProviderReference).findOne({
      where: this.providerReferenceWhere(user.id),
    });

    if (!reference && this.environment === 'production' && user.mapleradCustomerId) {
      reference = manager.getRepository(ProviderReference).create({
        user,
        userId: user.id,
        provider: 'maplerad',
        providerEnvironment: 'production',
        referenceType: 'customer',
        externalReference: user.mapleradCustomerId,
        providerCustomerId: user.mapleradCustomerId,
        status: 'legacy_imported',
        metadata: { source: 'user.mapleradCustomerId' },
      });
      await manager.getRepository(ProviderReference).save(reference);
    }

    if (reference?.providerCustomerId) {
      const customer = await this.getCustomerById(reference.providerCustomerId);
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
      return reference.providerCustomerId;
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

      reference = manager.getRepository(ProviderReference).create({
        user,
        userId: user.id,
        provider: 'maplerad',
        providerEnvironment: this.environment,
        referenceType: 'customer',
        externalReference: customerId,
        providerCustomerId: customerId,
        status: 'active',
      });
      await manager.getRepository(ProviderReference).save(reference);
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
      const user = await this.lockUser(manager, userId);
      if (!user) throw new Error('Papafi user not found');

      const repo = manager.getRepository(ProviderReference);
      const existingReference = await repo.findOne({ where: this.providerReferenceWhere(user.id) });
      if (existingReference?.providerCustomerId && existingReference.providerCustomerId !== customerId) {
        throw new Error(`Papafi user is already linked to a different ${this.environment} Maplerad customer`);
      }

      const existingCustomerReference = await repo.findOne({
        where: {
          provider: 'maplerad',
          providerEnvironment: this.environment,
          referenceType: 'customer',
          providerCustomerId: customerId,
        },
      });
      if (existingCustomerReference && existingCustomerReference.userId !== user.id) {
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

      const savedReference = existingReference || repo.create({
        user,
        userId: user.id,
        provider: 'maplerad',
        providerEnvironment: this.environment,
        referenceType: 'customer',
      });
      savedReference.providerCustomerId = customerId;
      savedReference.externalReference = customerId;
      savedReference.status = 'active';
      await repo.save(savedReference);
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

  private objectKeys(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as Record<string, unknown>).sort() : [];
  }

  private bvnDataFromEnvelope(envelope: unknown): Record<string, unknown> | undefined {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return undefined;
    const record = envelope as Record<string, unknown>;
    const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? record.data as Record<string, unknown>
      : record;
    return data;
  }

  private parseBvnVerificationResponse(input: {
    envelope: unknown;
    providerHttpStatus?: number;
    providerRequestId?: string;
  }): MapleradBvnVerificationResult {
    const envelope = input.envelope && typeof input.envelope === 'object' && !Array.isArray(input.envelope)
      ? input.envelope as Record<string, unknown>
      : undefined;
    const data = this.bvnDataFromEnvelope(input.envelope);
    const responseKeys = this.objectKeys(envelope);
    const dataKeys = this.objectKeys(data);

    if (!envelope || !data) {
      throw new MapleradProviderError(
        'Maplerad BVN verification returned malformed response',
        'maplerad.identity.verify_bvn',
        input.providerHttpStatus,
        'malformed response',
        input.providerRequestId,
        this.sanitizeProviderPayload(input.envelope),
        'SCHEMA'
      );
    }

    const rawProviderStatus = data.status ?? data.verification_status ?? envelope.status;
    const providerStatus = typeof rawProviderStatus === 'boolean' ? rawProviderStatus : undefined;
    const providerCode = data.code ?? envelope.code;
    const providerMessage = this.providerMessage(data) || this.providerMessage(envelope);
    const indicators = [
      data.verified,
      data.valid,
      data.is_valid,
      data.is_verified,
      rawProviderStatus,
      data.status_text,
      data.verification_status,
    ].map((value) => String(value ?? '').trim().toLowerCase());
    const message = String(providerMessage || '').toLowerCase();

    const explicitSuccess = input.providerHttpStatus !== undefined &&
      input.providerHttpStatus >= 200 &&
      input.providerHttpStatus < 300 &&
      rawProviderStatus === true &&
      data !== envelope;
    if (explicitSuccess) {
      return {
        verified: true,
        provider: 'maplerad',
        providerEnvironment: this.environment,
        applicationCode: 'BVN_VERIFIED',
        providerHttpStatus: input.providerHttpStatus,
        providerRequestId: input.providerRequestId,
        providerStatus,
        providerCode,
        providerMessage,
        identity: {
          firstName: data.first_name ? String(data.first_name) : undefined,
          middleName: data.middle_name ? String(data.middle_name) : undefined,
          lastName: data.last_name ? String(data.last_name) : undefined,
          dateOfBirth: data.dob || data.date_of_birth ? String(data.dob || data.date_of_birth) : undefined,
          phoneNumber: data.phone_number || data.phone ? String(data.phone_number || data.phone) : undefined,
          gender: data.gender ? String(data.gender) : undefined,
          image: data.image ? String(data.image) : undefined,
        },
        responseKeys,
        dataKeys,
      };
    }

    const explicitNotVerified =
      rawProviderStatus === false ||
      indicators.some((value) => ['failed', 'failure', 'invalid', 'unverified', 'not_found', 'not found'].includes(value)) ||
      message.includes('invalid bvn') ||
      message.includes('bvn not found') ||
      message.includes('not verified') ||
      message.includes('unable to verify bvn');

    if (explicitNotVerified) {
      return {
        verified: false,
        provider: 'maplerad',
        providerEnvironment: this.environment,
        applicationCode: 'BVN_NOT_VERIFIED',
        providerHttpStatus: input.providerHttpStatus,
        providerRequestId: input.providerRequestId,
        providerStatus,
        providerCode,
        providerMessage,
        responseKeys,
        dataKeys,
      };
    }

    throw new MapleradProviderError(
      'Maplerad BVN verification returned an unrecognised success response',
      'maplerad.identity.verify_bvn',
      input.providerHttpStatus,
      'unrecognised BVN response contract',
      input.providerRequestId,
      this.sanitizeProviderPayload(input.envelope),
      'SCHEMA'
    );
  }

  normalizeIdentityName(value?: string | null) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .replace(/[.'-]/g, '')
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('en-US');
  }

  normalizeNigerianPhone(value?: string | null) {
    const digits = String(value || '').replace(/\D/g, '');
    if (/^0[789]\d{9}$/.test(digits)) return `+234${digits.slice(1)}`;
    if (/^234[789]\d{9}$/.test(digits)) return `+${digits}`;
    if (/^[789]\d{9}$/.test(digits)) return `+234${digits}`;
    return undefined;
  }

  async verifyBvn(bvn: string): Promise<MapleradBvnVerificationResult> {
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

    const response = await this.requestMapleradRaw<any>({
      operation: 'maplerad.identity.verify_bvn',
      method: 'POST',
      path: '/identity/bvn',
      payload: { bvn: normalizedBvn },
    });

    return this.parseBvnVerificationResponse({
      envelope: response.data,
      providerHttpStatus: response.status,
      providerRequestId: this.providerRequestId(response.headers),
    });
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
      const user = await this.lockUser(manager, userId);
      if (!user) throw new Error(`MapleRad Error: User ${userId} not found`);

      const walletRepo = manager.getRepository(Wallet);
      const referenceRepo = manager.getRepository(ProviderReference);
      const existingWallet = await walletRepo.findOne({ where: { user: { id: user.id }, currency } });
      let reference = await referenceRepo.findOne({ where: this.providerReferenceWhere(user.id) });
      if (existingWallet?.accountNumber && existingWallet?.mapleradAccountId && reference?.providerAccountId) return existingWallet;

      const customerId = await this.ensureMapleRadCustomerForUser(user.id, manager);
      reference = await referenceRepo.findOne({ where: this.providerReferenceWhere(user.id) });
      if (reference?.providerAccountId && reference.accountNumber) {
        const wallet = this.applyVirtualAccountToWallet(
          existingWallet || walletRepo.create({ user }),
          {
            id: reference.providerAccountId,
            account_id: reference.providerAccountId,
            account_number: reference.accountNumber,
            bank_name: reference.bankName,
            currency,
          },
          currency
        );
        await walletRepo.save(wallet);
        return wallet;
      }

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

      const savedReference = reference || referenceRepo.create({
        user,
        userId: user.id,
        provider: 'maplerad',
        providerEnvironment: this.environment,
        referenceType: 'customer',
        providerCustomerId: customerId,
        status: 'active',
      });
      savedReference.providerCustomerId = customerId;
      savedReference.externalReference = customerId;
      savedReference.providerAccountId = data.id || data.account_id;
      savedReference.accountNumber = data.account_number;
      savedReference.bankName = data.bank_name || data.bank?.name;
      savedReference.currency = currency;
      savedReference.status = String(data.status || 'active');
      savedReference.metadata = { accountStatus: data.status };
      await referenceRepo.save(savedReference);

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
  private svixSecretBytes(secret: string) {
    if (!secret.startsWith('whsec_')) throw new Error('Maplerad webhook signing secret must begin with whsec_');
    return Buffer.from(secret.slice('whsec_'.length), 'base64');
  }

  private verifyWebhookSignatureWithSecret(secret: string, headers: MapleradWebhookHeaders, body: string): boolean {
    const { svixId, svixTimestamp, svixSignature } = headers;
    if (!svixId || !svixTimestamp || !svixSignature) return false;

    const timestamp = Number(svixTimestamp);
    if (!Number.isFinite(timestamp)) return false;
    const toleranceSeconds = Number(process.env.MAPLERAD_WEBHOOK_TOLERANCE_SECONDS || 300);
    if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) return false;

    const signedContent = `${svixId}.${svixTimestamp}.${body}`;
    const expected = crypto.createHmac('sha256', this.svixSecretBytes(secret)).update(signedContent).digest('base64');
    const expectedBuffer = Buffer.from(expected);

    return svixSignature.split(' ').some((entry) => {
      const [version, signature] = entry.includes(',') ? entry.split(',', 2) : ['', entry];
      if (version && version !== 'v1') return false;
      if (!signature) return false;
      const receivedBuffer = Buffer.from(signature);
      return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
    });
  }

  verifyWebhookSignature(headersOrSignature: MapleradWebhookHeaders | string, body: string): boolean {
    if (!this.webhookSecret) throw new Error(`Missing Maplerad ${this.environment} webhook signing secret`);
    if (typeof headersOrSignature === 'string') return false;

    return (
      this.verifyWebhookSignatureWithSecret(this.webhookSecret, headersOrSignature, body) ||
      Boolean(this.previousWebhookSecret && this.verifyWebhookSignatureWithSecret(this.previousWebhookSecret, headersOrSignature, body))
    );
  }

  isAllowedWebhookSourceIp(ip?: string) {
    if (!ip) return false;
    return this.config.webhookAllowedIps.includes(ip);
  }

  async verifyWebhookByProviderRequery(eventData: MapleradWebhookEvent): Promise<boolean> {
    if (!eventData?.eventId || !eventData?.event || !eventData.reference) return false;

    try {
      if (eventData.type === 'DEPOSIT_RECORDED') {
        const providerTx = await this.getTransactionById(eventData.reference);
        const status = String(providerTx?.status || '').toLowerCase();
        const amount = Number(providerTx?.amount) / 100;
        return (
          ['success', 'successful', 'completed'].includes(status) &&
          Number(eventData.amount) === amount &&
          providerTx?.currency === eventData.currency &&
          (providerTx?.customer_id === eventData.customerId || providerTx?.customer?.id === eventData.customerId)
        );
      }

      if (eventData.type === 'TRANSFER_EVENT') {
        const providerTx = await this.getTransactionById(eventData.reference);
        const status = String(providerTx?.status || '').toLowerCase();
        if (eventData.event === 'transfer.successful') return ['success', 'successful', 'completed'].includes(status);
        if (eventData.event === 'transfer.failed') return ['failed', 'declined', 'reversed'].includes(status);
      }

      return false;
    } catch (error) {
      logger.warn('maplerad_webhook_requery_failed', {
        eventId: eventData.eventId,
        event: eventData.event,
        reference: eventData.reference,
      });
      return false;
    }
  }

  async verifyWebhookRequest(input: {
    headers: MapleradWebhookHeaders;
    rawBody: string;
    sourceIp?: string;
    eventData?: MapleradWebhookEvent;
  }): Promise<MapleradWebhookVerificationResult> {
    if (this.webhookVerificationMode === 'disabled') {
      if (process.env.NODE_ENV === 'production') {
        return { ok: false, status: 500, message: 'Webhook verification disabled is not allowed in production', mode: 'disabled' };
      }
      return { ok: true, mode: 'disabled', warning: 'Webhook verification disabled for local/test only' };
    }

    if (this.webhookVerificationMode === 'signature') {
      if (!input.headers.svixId || !input.headers.svixTimestamp || !input.headers.svixSignature) {
        return { ok: false, status: 400, message: 'Missing Maplerad webhook signature headers', mode: 'signature' };
      }
      if (!this.verifyWebhookSignature(input.headers, input.rawBody)) {
        return { ok: false, status: 401, message: 'Invalid Maplerad webhook signature', mode: 'signature' };
      }
      return { ok: true, mode: 'signature' };
    }

    if (!this.isAllowedWebhookSourceIp(input.sourceIp)) {
      return { ok: false, status: 401, message: 'Unrecognized Maplerad webhook source IP', mode: 'ip_and_requery' };
    }
    if (!input.eventData?.eventId || !input.eventData?.event) {
      return { ok: false, status: 400, message: 'Missing Maplerad webhook event id or type', mode: 'ip_and_requery' };
    }
    const verified = await this.verifyWebhookByProviderRequery(input.eventData);
    if (!verified) {
      return { ok: false, status: 202, message: 'Maplerad webhook accepted but not processed because provider re-query did not confirm it', mode: 'ip_and_requery' };
    }
    logger.warn('maplerad_webhook_signature_unavailable_fallback_used', {
      eventId: input.eventData.eventId,
      event: input.eventData.event,
      providerEnvironment: this.environment,
    });
    return { ok: true, mode: 'ip_and_requery', warning: 'Signature verification unavailable; IP and provider re-query fallback used' };
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
