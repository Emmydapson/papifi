// src/services/mapleradService.ts
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import crypto from 'crypto';
import { EntityManager } from 'typeorm';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import { Currency, Wallet } from '../entities/Wallet';
import { Profile } from '../entities/profile';
import { Transaction } from '../entities/Transaction';
import { VirtualCard } from '../entities/virtualCard';
import { AuditLog } from '../entities/AuditLog';
import { ProviderReference } from '../entities/ProviderReference';
import { MapleradCustomerRecoveryAttempt } from '../entities/MapleradCustomerRecoveryAttempt';
import { logger } from './logger';
import { resolveMapleradConfig, ResolvedMapleradConfig } from '../config/maplerad';

type MapleradEnvelope<T> = {
  status?: string | boolean;
  message?: string;
  data?: T;
  [key: string]: unknown;
};

export type MapleradCustomer = {
  id: string;
  customer_id?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  email?: string;
  country?: string;
  dob?: string;
  date_of_birth?: string;
  dateOfBirth?: string;
  phone_number?: string;
  tier?: string;
  level?: string | number;
  account_tier?: string | number;
  customer_tier?: string | number;
  phone?: unknown;
  address?: unknown;
};

type MapleradCustomerRecoveryCode =
  | 'MAPLERAD_CUSTOMER_NOT_FOUND'
  | 'MAPLERAD_CUSTOMER_AMBIGUOUS'
  | 'MAPLERAD_CUSTOMER_IDENTITY_MISMATCH'
  | 'MAPLERAD_CUSTOMER_RECOVERY_PROFILE_INCOMPLETE'
  | 'MAPLERAD_CUSTOMER_RECONCILIATION_REQUIRED';

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

type MapleradVirtualAccountCollectionKey = 'root' | 'accounts' | 'items' | 'virtual_accounts';

type MapleradVirtualAccountResponseShape = {
  operation: string;
  endpoint: string;
  httpStatus: number;
  providerRequestId?: string;
  topLevelKeys: string[];
  dataLevelKeys: string[];
  nestedDataLevelKeys: string[];
  bodyIsArray: boolean;
  unwrappedIsArray: boolean;
  recognizedCollectionKey: MapleradVirtualAccountCollectionKey | null;
  recognizedCollectionLength: number;
  firstCollectionItemKeys: string[];
};

type MapleradVirtualAccountCreateResponseShape = {
  operation: string;
  endpoint: string;
  httpStatus: number;
  providerRequestId?: string;
  topLevelKeys: string[];
  dataLevelKeys: string[];
  nestedDataLevelKeys: string[];
  bodyIsArray: boolean;
  unwrappedIsArray: boolean;
  accountObjectLocation: string | null;
  rootKeys: string[];
  accountKeys: string[];
  virtualAccountKeys: string[];
  dataAccountKeys: string[];
  dataVirtualAccountKeys: string[];
  nestedDataAccountKeys: string[];
  nestedDataVirtualAccountKeys: string[];
  hasRootId: boolean;
  hasRootAccountId: boolean;
  hasRootReference: boolean;
  hasRootAccountNumber: boolean;
  hasAccountObject: boolean;
  hasVirtualAccountObject: boolean;
  hasAccountId: boolean;
  hasAccountAccountId: boolean;
  hasAccountReference: boolean;
  hasAccountAccountNumber: boolean;
  hasVirtualAccountId: boolean;
  hasVirtualAccountAccountId: boolean;
  hasVirtualAccountReference: boolean;
  hasVirtualAccountAccountNumber: boolean;
  hasRootAccountNumberCamel: boolean;
  hasRootAccountIdCamel: boolean;
  hasAccountNumberCamel: boolean;
  hasAccountIdCamel: boolean;
  hasVirtualAccountNumberCamel: boolean;
  hasVirtualAccountIdCamel: boolean;
};

type MapleradRequestOptions = {
  operation: string;
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  logPath?: string;
  payload?: unknown;
  params?: Record<string, unknown>;
  onErrorResponse?: (response: AxiosResponse<unknown>) => void;
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
  | 'CUSTOMER_NOT_TIER1'
  | 'MAPLERAD_TIER1_PROFILE_INCOMPLETE'
  | 'MAPLERAD_TIER1_ENROLLMENT_FAILED'
  | 'BVN_NOT_VERIFIED'
  | 'BVN_INVALID'
  | 'BVN_IDENTITY_MISMATCH'
  | 'BVN_REVIEW_REQUIRED'
  | 'MAPLERAD_INSUFFICIENT_BALANCE'
  | 'MAPLERAD_AUTHENTICATION_FAILED'
  | 'MAPLERAD_CONFIGURATION_ERROR'
  | 'MAPLERAD_CUSTOMER_RECONCILIATION_REQUIRED'
  | 'MAPLERAD_CUSTOMER_NOT_FOUND'
  | 'MAPLERAD_CUSTOMER_AMBIGUOUS'
  | 'MAPLERAD_CUSTOMER_IDENTITY_MISMATCH'
  | 'MAPLERAD_CUSTOMER_RECOVERY_PROFILE_INCOMPLETE'
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

export class MapleradCustomerRecoveryError extends MapleradProviderError {
  constructor(
    public readonly applicationCode: MapleradCustomerRecoveryCode,
    message: string,
    public readonly action = 'ADMIN_RECONCILIATION_REQUIRED',
    providerStatus?: number,
    providerMessage?: string,
    requestId?: string,
    safeResponseBody?: unknown
  ) {
    super(message, 'maplerad.customer.recover', providerStatus, providerMessage, requestId, safeResponseBody, 'VALIDATION');
    this.name = 'MapleradCustomerRecoveryError';
  }
}

export const isMapleradProviderError = (error: unknown): error is MapleradProviderError =>
  error instanceof MapleradProviderError;

export const mapleradErrorToHttpStatus = (error: unknown) => {
  if (!isMapleradProviderError(error)) return 502;
  if (error instanceof MapleradCustomerRecoveryError) return 400;
  if (mapleradErrorToApplicationCode(error) === 'MAPLERAD_CUSTOMER_RECONCILIATION_REQUIRED') return 400;
  if (mapleradErrorToApplicationCode(error) === 'CUSTOMER_NOT_TIER1') return 400;
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
  if (error instanceof MapleradCustomerRecoveryError) return error.applicationCode as MapleradApplicationErrorCode;
  const message = String(error.providerMessage || '').toLowerCase();
  if (error.operation === 'maplerad.customer.upgrade_tier1.prepare') return 'MAPLERAD_TIER1_PROFILE_INCOMPLETE';
  if (error.operation.includes('maplerad.customer.upgrade_tier1')) return 'MAPLERAD_TIER1_ENROLLMENT_FAILED';
  if (error.operation === 'maplerad.customer.create' && message.includes('already enrolled')) {
    return 'MAPLERAD_CUSTOMER_RECONCILIATION_REQUIRED';
  }
  if (
    message.includes('tier 1') ||
    message.includes('tier1') ||
    message.includes('customer must complete tier 1') ||
    message.includes('service is only available for tier')
  ) {
    return 'CUSTOMER_NOT_TIER1';
  }
  if (error.code === 'ACCOUNT' || message.includes('insufficient balance')) return 'MAPLERAD_INSUFFICIENT_BALANCE';
  if (error.code === 'AUTH') {
    return error.providerStatus === 403 ? 'MAPLERAD_CONFIGURATION_ERROR' : 'MAPLERAD_AUTHENTICATION_FAILED';
  }
  if (error.code === 'VALIDATION' || error.code === 'NOT_FOUND') return 'MAPLERAD_VALIDATION_ERROR';
  if (error.code === 'RATE_LIMIT') return 'MAPLERAD_RATE_LIMITED';
  if (error.code === 'SCHEMA') return 'MAPLERAD_CONTRACT_ERROR';
  return 'MAPLERAD_UNAVAILABLE';
};

export const mapleradErrorToClientResponse = (error: MapleradProviderError) => {
  const code = mapleradErrorToApplicationCode(error);
  return {
    ok: false,
    code,
    message:
      code === 'MAPLERAD_CUSTOMER_RECONCILIATION_REQUIRED'
        ? 'An existing Maplerad customer must be linked before creating this account.'
        : code === 'MAPLERAD_CUSTOMER_RECOVERY_PROFILE_INCOMPLETE'
        ? 'Complete the required verified profile details before wallet provisioning can continue.'
        : code === 'CUSTOMER_NOT_TIER1'
        ? 'Customer must complete Tier 1 KYC before a NGN virtual account can be created.'
        : error.message,
    providerStatus: error.providerStatus,
    providerMessage: error.providerMessage,
    requestId: error.requestId,
    action: error instanceof MapleradCustomerRecoveryError ? error.action : undefined,
  };
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

type Tier1AddressInput = {
  street?: string;
  street2?: string | null;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  postalCode?: string;
};

type Tier1UpgradeInput = {
  bvn: string;
  dateOfBirth?: string;
  phoneNumber?: string;
  address?: string | Tier1AddressInput;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  postal_code?: string;
  photo?: string;
};

export type MapleradTier1EnrollmentState =
  | 'NOT_STARTED'
  | 'PROFILE_INCOMPLETE'
  | 'PENDING'
  | 'PROCESSING'
  | 'TIER_1'
  | 'RETRYING'
  | 'RECONCILIATION_REQUIRED'
  | 'FAILED';

export type MapleradTier1EnrollmentResult = {
  customerId: string;
  customer?: MapleradCustomer;
  upgraded: boolean;
  tier1: boolean;
  state: MapleradTier1EnrollmentState;
  missingFields?: string[];
  code?: string;
  providerStatus?: number;
  providerMessage?: string;
  requestId?: string;
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
  private lastVirtualAccountListResponseShape?: MapleradVirtualAccountResponseShape;

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
          normalized.includes('identification_number') ||
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
    const value =
      body?.message ||
      body?.error ||
      body?.errors?.[0]?.message ||
      body?.errors?.[0] ||
      body?.detail ||
      body?.data?.message ||
      body?.data?.error;
    return value ? String(value).slice(0, 240) : undefined;
  }

  private hasProviderErrorPayload(body: any) {
    if (!body || typeof body !== 'object') return false;
    const status = String(body.status ?? body.data?.status ?? '').toLowerCase();
    const ok = body.ok ?? body.success ?? body.data?.ok ?? body.data?.success;
    return (
      Boolean(body.error || body.errors || body.detail || body.data?.error || body.data?.errors) ||
      ok === false ||
      ['false', 'failed', 'failure', 'error'].includes(status)
    );
  }

  private extractMapleradCustomer(body: any): MapleradCustomer | undefined {
    const candidates = [
      body?.data?.customer,
      body?.customer,
      body?.data?.data?.customer,
      body?.data?.data,
      body?.data,
      body,
    ];
    return candidates.find((candidate) => candidate && typeof candidate === 'object' && (candidate.id || candidate.customer_id));
  }

  private parseCustomerCreateResponse(body: any): MapleradCustomer {
    if (this.hasProviderErrorPayload(body)) {
      const providerMessage = this.providerMessage(body) || 'Maplerad returned an error payload';
      throw new MapleradProviderError(
        `maplerad.customer.create failed: ${providerMessage}`,
        'maplerad.customer.create',
        undefined,
        providerMessage,
        undefined,
        this.sanitizeProviderPayload(body),
        this.providerErrorCode(undefined, providerMessage)
      );
    }

    const customer = this.extractMapleradCustomer(body);
    const customerId = customer?.id || customer?.customer_id;
    if (!customerId) {
      throw new MapleradProviderError(
        'Maplerad customer creation returned malformed response',
        'maplerad.customer.create',
        undefined,
        'missing customer id',
        undefined,
        this.sanitizeProviderPayload(body),
        'SCHEMA'
      );
    }

    return { ...customer, id: String(customerId) };
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
        endpoint: options.logPath || options.path,
        status: res.status,
        requestId: this.providerRequestId(res.headers),
      });
      return res;
    } catch (error: any) {
      if (error?.response && options.onErrorResponse) {
        options.onErrorResponse(error.response);
      }
      const status = error?.response?.status;
      const safeBody = this.sanitizeProviderPayload(error?.response?.data);
      const providerMessage = this.providerMessage(error?.response?.data);
      const requestId = this.providerRequestId(error?.response?.headers);
      const code = this.providerErrorCode(status, providerMessage, error?.code);

      logger.error('maplerad_provider_request_failed', new Error('Maplerad provider request failed'), {
        operation: options.operation,
        endpoint: options.logPath || options.path,
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

  private normalizeEmail(value?: string | null) {
    return this.normalize(value);
  }

  private normalizePhoneForMatch(value?: unknown): string {
    if (!value) return '';
    if (typeof value === 'object') {
      const record = value as any;
      const countryCode =
        record.phone_country_code ||
        record.country_code ||
        record.countryCode ||
        record.code ||
        '';
      const number = record.phone_number || record.phoneNumber || record.number || record.value || '';
      return this.normalizePhoneForMatch(`${countryCode}${number}`);
    }
    const raw = String(value).trim();
    const digits = raw.replace(/\D/g, '');
    return this.normalizeNigerianPhone(digits) || '';
  }

  private normalizeDateForMatch(value?: string | null) {
    if (!value) return '';
    const trimmed = value.trim();
    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = trimmed.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }

  private customerPhone(customer: MapleradCustomer) {
    return (
      customer.phone ||
      customer.phone_number ||
      (customer as any).phoneNumber ||
      (customer as any).mobile ||
      (customer as any).data?.phone
    );
  }

  private customerDob(customer: MapleradCustomer) {
    return customer.dob || customer.date_of_birth || customer.dateOfBirth || (customer as any).date_of_birth || (customer as any).data?.dob;
  }

  private validateCustomerMatch(user: User, customer: MapleradCustomer) {
    const mismatches: string[] = [];
    if (customer.email && this.normalize(customer.email) !== this.normalize(user.email)) mismatches.push('email');
    if (customer.first_name && this.normalizeName(customer.first_name) !== this.normalizeName(user.firstName)) mismatches.push('first_name');
    if (customer.last_name && this.normalizeName(customer.last_name) !== this.normalizeName(user.lastName)) mismatches.push('last_name');
    return { ok: mismatches.length === 0, mismatches };
  }

  private async verifiedIdentityForUser(user: User, manager?: EntityManager) {
    const repo = (manager || AppDataSource.manager).getRepository(Profile);
    const profile = typeof (repo as any).findOne === 'function'
      ? await repo.findOne({ where: { user: { id: user.id } } })
      : undefined;
    const email = this.normalizeEmail(profile?.email || user.email);
    const phone = this.normalizePhoneForMatch(profile?.phoneNumber || user.phoneNumber);
    const firstName = this.normalizeName(profile?.firstName || user.firstName);
    const lastName = this.normalizeName(profile?.lastName || user.lastName);
    const dob = this.normalizeDateForMatch(profile?.dateOfBirth);
    const sufficientlyVerified = Boolean(user.isVerified && user.isKYCVerified && email && phone && firstName && lastName);
    return { sufficientlyVerified, email, phone, firstName, lastName, dob };
  }

  private maskedUserId(userId: string) {
    return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 12);
  }

  private safeRecoveryFingerprint(identity: {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    dob?: string;
  }) {
    const hash = (value?: string) => (value ? crypto.createHash('sha256').update(value).digest('hex') : null);
    return crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          providerEnvironment: this.environment,
          emailHash: hash(identity.email),
          phoneHash: hash(identity.phone),
          firstNameHash: hash(identity.firstName),
          lastNameHash: hash(identity.lastName),
          dobHash: hash(identity.dob),
        })
      )
      .digest('hex');
  }

  private recoveryParserVersion() {
    return 'customers-list-v2';
  }

  public async evaluateCustomerIdentityMatch(user: User, customer: MapleradCustomer, manager?: EntityManager) {
    const identity = await this.verifiedIdentityForUser(user, manager);
    const customerEmail = this.normalizeEmail(customer.email);
    const customerPhone = this.normalizePhoneForMatch(this.customerPhone(customer));
    const customerFirstName = this.normalizeName(customer.first_name);
    const customerLastName = this.normalizeName(customer.last_name);
    const customerDob = this.normalizeDateForMatch(this.customerDob(customer));
    const matchedFields: string[] = [];
    const mismatches: string[] = [];

    if (!identity.sufficientlyVerified) mismatches.push('verified_identity');
    if (identity.email && customerEmail && identity.email === customerEmail) matchedFields.push('email');
    else mismatches.push('email');
    if (identity.phone && customerPhone && identity.phone === customerPhone) matchedFields.push('phone');
    else mismatches.push('phone');
    if (identity.firstName && customerFirstName && identity.firstName === customerFirstName) matchedFields.push('first_name');
    else mismatches.push('first_name');
    if (identity.lastName && customerLastName && identity.lastName === customerLastName) matchedFields.push('last_name');
    else mismatches.push('last_name');
    if (identity.dob && customerDob) {
      if (identity.dob === customerDob) matchedFields.push('dob');
      else mismatches.push('dob');
    }

    return {
      exact: mismatches.length === 0,
      matchedFields,
      mismatches,
      identityAvailable: identity.sufficientlyVerified,
    };
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

  private providerAccountReferenceWhere(userId: string, currency: Currency) {
    return {
      userId,
      provider: 'maplerad',
      providerEnvironment: this.environment,
      referenceType: 'account',
      currency,
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

  async ensureMapleRadCustomer(userId: string, options: { forceRecoveryRetry?: boolean } = {}): Promise<string> {
    return AppDataSource.transaction(async (manager) => this.ensureMapleRadCustomerForUser(userId, manager, options));
  }

  async resolveOrCreateMapleradCustomer(userId: string, options: { forceRecoveryRetry?: boolean } = {}): Promise<string> {
    return this.ensureMapleRadCustomer(userId, options);
  }

  private async persistCustomerReference(
    manager: EntityManager,
    user: User,
    customerId: string,
    status: string,
    metadata: Record<string, unknown> = {}
  ) {
    const repo = manager.getRepository(ProviderReference);
    const existingReference = await repo.findOne({ where: this.providerReferenceWhere(user.id) });
    if (existingReference?.providerCustomerId) return existingReference.providerCustomerId;

    const linkedReference = await repo.findOne({
      where: {
        provider: 'maplerad',
        providerEnvironment: this.environment,
        referenceType: 'customer',
        providerCustomerId: customerId,
      },
    });
    if (linkedReference && linkedReference.userId !== user.id) {
      throw new MapleradCustomerRecoveryError(
        'MAPLERAD_CUSTOMER_IDENTITY_MISMATCH',
        'The existing Maplerad customer identity could not be safely validated.'
      );
    }

    const reference = repo.create({
      user,
      userId: user.id,
      provider: 'maplerad',
      providerEnvironment: this.environment,
      referenceType: 'customer',
      externalReference: customerId,
      providerCustomerId: customerId,
      status,
      metadata: this.sanitizeProviderPayload(metadata),
    });
    await repo.save(reference);
    await manager.getRepository(AuditLog).save(
      manager.getRepository(AuditLog).create({
        actorUserId: user.id,
        targetUserId: user.id,
        action: status === 'auto_recovered' ? 'MAPLERAD_CUSTOMER_AUTO_RECONCILED' : 'MAPLERAD_CUSTOMER_LINKED',
        entityType: 'ProviderReference',
        entityId: reference.id,
        metadata: this.sanitizeProviderPayload({
          provider: 'maplerad',
          providerEnvironment: this.environment,
          providerCustomerId: customerId,
          ...metadata,
        }),
      })
    );
    return customerId;
  }

  private recoveryErrorFromResult(result: string, providerStatus?: number, providerMessage?: string, requestId?: string) {
    if (result === 'profile_incomplete') {
      return new MapleradCustomerRecoveryError(
        'MAPLERAD_CUSTOMER_RECOVERY_PROFILE_INCOMPLETE',
        'Complete the required verified profile details before wallet provisioning can continue.',
        'COMPLETE_PROFILE',
        providerStatus,
        providerMessage,
        requestId
      );
    }
    if (result === 'ambiguous') {
      return new MapleradCustomerRecoveryError(
        'MAPLERAD_CUSTOMER_AMBIGUOUS',
        'Multiple Maplerad customers matched this identity.',
        'ADMIN_RECONCILIATION_REQUIRED',
        providerStatus,
        providerMessage,
        requestId
      );
    }
    if (result === 'identity_mismatch') {
      return new MapleradCustomerRecoveryError(
        'MAPLERAD_CUSTOMER_IDENTITY_MISMATCH',
        'The existing Maplerad customer identity could not be safely validated.',
        'ADMIN_RECONCILIATION_REQUIRED',
        providerStatus,
        providerMessage,
        requestId
      );
    }
    if (result === 'persistence_failed') {
      return new MapleradCustomerRecoveryError(
        'MAPLERAD_CUSTOMER_RECONCILIATION_REQUIRED',
        'An existing Maplerad customer must be linked before creating this account.',
        'ADMIN_RECONCILIATION_REQUIRED',
        providerStatus,
        providerMessage,
        requestId
      );
    }
    return new MapleradCustomerRecoveryError(
      'MAPLERAD_CUSTOMER_NOT_FOUND',
      'An existing Maplerad customer could not be safely matched.',
      'ADMIN_RECONCILIATION_REQUIRED',
      providerStatus,
      providerMessage,
      requestId
    );
  }

  private async recoverAlreadyEnrolledCustomer(user: User, manager: EntityManager, sourceError: MapleradProviderError, options: { force?: boolean } = {}) {
    const identity = await this.verifiedIdentityForUser(user, manager);
    const identityFingerprint = this.safeRecoveryFingerprint(identity);
    logger.info('maplerad_customer_recovery_started', {
      user: this.maskedUserId(user.id),
      providerEnvironment: this.environment,
      identityFingerprint,
      hasEmail: Boolean(identity.email),
      hasPhone: Boolean(identity.phone),
      hasFirstName: Boolean(identity.firstName),
      hasLastName: Boolean(identity.lastName),
      hasDob: Boolean(identity.dob),
      verifiedIdentity: identity.sufficientlyVerified,
      requestId: sourceError.requestId,
    });
    if (!identity.sufficientlyVerified) {
      await this.recordRecoveryAttempt(user.id, 'already_enrolled', 'profile_incomplete', { identityFingerprint });
      throw this.recoveryErrorFromResult('profile_incomplete', sourceError.providerStatus, sourceError.providerMessage, sourceError.requestId);
    }

    const cooldown = options.force ? undefined : await this.activeRecoveryCooldown(user.id, 'already_enrolled', identityFingerprint);
    if (cooldown) throw this.recoveryErrorFromResult(cooldown.result, sourceError.providerStatus, sourceError.providerMessage, sourceError.requestId);

    try {
      const result = await this.discoverMatchingMapleradCustomers(user, manager);
      if (result.exactMatches.length === 0) {
        const recoveryResult = result.partialMatches.length > 0 ? 'identity_mismatch' : 'not_found';
        logger.info('maplerad_customer_recovery_no_match', {
          user: this.maskedUserId(user.id),
          providerEnvironment: this.environment,
          scanned: result.scanned,
          partialMatches: result.partialMatches.length,
          requestIds: result.requestIds,
        });
        await this.recordRecoveryAttempt(user.id, 'already_enrolled', recoveryResult, {
          identityFingerprint,
          scanned: result.scanned,
          partialMatches: result.partialMatches.length,
          requestIds: result.requestIds,
        });
        throw this.recoveryErrorFromResult(recoveryResult, sourceError.providerStatus, sourceError.providerMessage, sourceError.requestId);
      }
      if (result.exactMatches.length > 1) {
        logger.warn('maplerad_customer_recovery_ambiguous', {
          user: this.maskedUserId(user.id),
          providerEnvironment: this.environment,
          scanned: result.scanned,
          exactMatches: result.exactMatches.length,
          requestIds: result.requestIds,
        });
        await this.recordRecoveryAttempt(user.id, 'already_enrolled', 'ambiguous', {
          identityFingerprint,
          scanned: result.scanned,
          exactMatches: result.exactMatches.length,
          requestIds: result.requestIds,
        });
        throw this.recoveryErrorFromResult('ambiguous', sourceError.providerStatus, sourceError.providerMessage, sourceError.requestId);
      }

      const exact = result.exactMatches[0];
      const customerId = exact.customer.id;
      logger.info('maplerad_customer_recovery_exact_match', {
        user: this.maskedUserId(user.id),
        providerEnvironment: this.environment,
        matchedFields: exact.matchedFields,
        scanned: result.scanned,
        requestIds: result.requestIds,
      });
      const persistedCustomerId = await this.persistCustomerReference(manager, user, customerId, 'auto_recovered', {
        recoveryMethod: 'bounded_customer_pagination',
        matchedFields: exact.matchedFields,
        scanned: result.scanned,
        requestIds: result.requestIds,
      });
      await this.recordRecoveryAttempt(user.id, 'already_enrolled', 'success', {
        identityFingerprint,
        scanned: result.scanned,
        requestIds: result.requestIds,
      });
      logger.info('maplerad_customer_recovery_linked', {
        user: this.maskedUserId(user.id),
        providerEnvironment: this.environment,
        requestIds: result.requestIds,
      });
      return persistedCustomerId;
    } catch (error) {
      if (error instanceof MapleradCustomerRecoveryError) throw error;
      await this.recordRecoveryAttempt(user.id, 'already_enrolled', 'provider_unavailable', {
        identityFingerprint,
        message: isMapleradProviderError(error) ? error.providerMessage || error.message : (error as any)?.message,
      });
      throw new MapleradCustomerRecoveryError(
        'MAPLERAD_CUSTOMER_RECONCILIATION_REQUIRED',
        'An existing Maplerad customer must be linked before creating this account.',
        'ADMIN_RECONCILIATION_REQUIRED',
        sourceError.providerStatus,
        sourceError.providerMessage,
        sourceError.requestId
      );
    }
  }

  private async ensureMapleRadCustomerForUser(userId: string, manager: EntityManager, options: { forceRecoveryRetry?: boolean } = {}): Promise<string> {
    const user = await this.lockUser(manager, userId);
    if (!user) throw new Error('User not found');

    let reference = await manager.getRepository(ProviderReference).findOne({
      where: this.providerReferenceWhere(user.id),
    });

    if (!reference && this.environment === 'production' && user.mapleradCustomerId) {
      const legacyCustomer = await this.getCustomerById(user.mapleradCustomerId);
      const match = this.validateCustomerMatch(user, legacyCustomer);
      if (!match.ok) {
        throw new MapleradProviderError(
          `Legacy Maplerad customer does not match Papafi user: ${match.mismatches.join(', ')}`,
          'maplerad.customer.validate_legacy',
          400,
          'legacy customer mismatch',
          undefined,
          { mismatches: match.mismatches },
          'VALIDATION'
        );
      }
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
      await this.persistCustomerReference(manager, user, user.mapleradCustomerId, 'legacy_imported', { source: 'user.mapleradCustomerId' });
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

    const identity = await this.verifiedIdentityForUser(user, manager);
    const identityFingerprint = this.safeRecoveryFingerprint(identity);
    const partialFailureCooldown = await this.activeRecoveryCooldown(user.id, 'customer_create_persistence', identityFingerprint);
    if (partialFailureCooldown) {
      throw this.recoveryErrorFromResult('persistence_failed');
    }

    const payload = {
      first_name: user.firstName,
      last_name: user.lastName,
      email: user.email,
      country: 'NG',
    };

    try {
      const response = await this.requestMapleradRaw<MapleradCustomer>({
        operation: 'maplerad.customer.create',
        method: 'POST',
        path: '/customers',
        payload,
      });
      logger.info('maplerad_customer_create_provider_response', {
        operation: 'maplerad.customer.create',
        endpoint: '/customers',
        providerStatus: response.status,
        requestId: this.providerRequestId(response.headers),
      });

      const customer = this.parseCustomerCreateResponse(response.data);
      const customerId = customer.id;

      try {
        return await this.persistCustomerReference(manager, user, customerId, 'active', {
          source: 'maplerad.customer.create',
          requestId: this.providerRequestId(response.headers),
        });
      } catch (persistenceError) {
        logger.error('maplerad_customer_reference_persist_failed_after_provider_create', persistenceError as Error, {
          userId: user.id,
          providerEnvironment: this.environment,
          providerCustomerId: customerId,
        });
        await this.recordRecoveryAttempt(user.id, 'customer_create_persistence', 'persistence_failed', {
          identityFingerprint,
          providerCustomerId: customerId,
          requestId: this.providerRequestId(response.headers),
        });
        throw new MapleradCustomerRecoveryError(
          'MAPLERAD_CUSTOMER_RECONCILIATION_REQUIRED',
          'An existing Maplerad customer must be linked before creating this account.',
          'ADMIN_RECONCILIATION_REQUIRED',
          undefined,
          'customer reference persistence failed',
          this.providerRequestId(response.headers)
        );
      }
    } catch (error) {
      if (
        isMapleradProviderError(error) &&
        error.code === 'VALIDATION' &&
        String(error.providerMessage || '').toLowerCase().includes('already enrolled')
      ) {
        return this.recoverAlreadyEnrolledCustomer(user, manager, error, { force: options.forceRecoveryRetry });
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

  private objectRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  }

  private objectKeys(value: unknown) {
    return this.objectRecord(value) ? Object.keys(value as Record<string, unknown>).sort() : [];
  }

  private objectChild(value: unknown, key: string): Record<string, unknown> | undefined {
    return this.objectRecord(this.objectRecord(value)?.[key]);
  }

  private hasObjectKey(value: unknown, key: string) {
    const record = this.objectRecord(value);
    return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
  }

  private diagnosticUnwrapBody(body: unknown) {
    const record = this.objectRecord(body);
    return record && Object.prototype.hasOwnProperty.call(record, 'data') ? record.data : body;
  }

  private hasAnyVirtualAccountIdentityKey(value: unknown) {
    return ['id', 'account_id', 'reference', 'account_number', 'accountId', 'accountNumber'].some((key) =>
      this.hasObjectKey(value, key)
    );
  }

  private firstObject(candidates: Array<Record<string, unknown> | undefined>) {
    return candidates.find(Boolean);
  }

  private virtualAccountCreateResponseShape(input: {
    operation: string;
    endpoint: string;
    httpStatus: number;
    providerRequestId?: string;
    body: unknown;
  }): MapleradVirtualAccountCreateResponseShape {
    const body = input.body;
    const unwrapped = this.diagnosticUnwrapBody(body);
    const root = this.objectRecord(body);
    const data = this.objectRecord(root?.data);
    const nestedData = this.objectRecord(data?.data);
    const account = this.objectChild(root, 'account');
    const virtualAccount = this.objectChild(root, 'virtual_account');
    const dataAccount = this.objectChild(data, 'account');
    const dataVirtualAccount = this.objectChild(data, 'virtual_account');
    const nestedDataAccount = this.objectChild(nestedData, 'account');
    const nestedDataVirtualAccount = this.objectChild(nestedData, 'virtual_account');
    const accountObject = this.firstObject([account, dataAccount, nestedDataAccount]);
    const virtualAccountObject = this.firstObject([virtualAccount, dataVirtualAccount, nestedDataVirtualAccount]);
    const accountObjectLocation =
      ([
        ['root', root],
        ['account', account],
        ['virtual_account', virtualAccount],
        ['data', data],
        ['data.account', dataAccount],
        ['data.virtual_account', dataVirtualAccount],
        ['data.data', nestedData],
        ['data.data.account', nestedDataAccount],
        ['data.data.virtual_account', nestedDataVirtualAccount],
      ] as Array<[string, Record<string, unknown> | undefined]>).find(([_location, value]) =>
        this.hasAnyVirtualAccountIdentityKey(value)
      )?.[0] || null;

    return {
      operation: input.operation,
      endpoint: input.endpoint,
      httpStatus: input.httpStatus,
      providerRequestId: input.providerRequestId,
      topLevelKeys: this.objectKeys(body),
      dataLevelKeys: this.objectKeys(data),
      nestedDataLevelKeys: this.objectKeys(nestedData),
      bodyIsArray: Array.isArray(body),
      unwrappedIsArray: Array.isArray(unwrapped),
      accountObjectLocation,
      rootKeys: this.objectKeys(root),
      accountKeys: this.objectKeys(account),
      virtualAccountKeys: this.objectKeys(virtualAccount),
      dataAccountKeys: this.objectKeys(dataAccount),
      dataVirtualAccountKeys: this.objectKeys(dataVirtualAccount),
      nestedDataAccountKeys: this.objectKeys(nestedDataAccount),
      nestedDataVirtualAccountKeys: this.objectKeys(nestedDataVirtualAccount),
      hasRootId: this.hasObjectKey(root, 'id'),
      hasRootAccountId: this.hasObjectKey(root, 'account_id'),
      hasRootReference: this.hasObjectKey(root, 'reference'),
      hasRootAccountNumber: this.hasObjectKey(root, 'account_number'),
      hasAccountObject: Boolean(accountObject),
      hasVirtualAccountObject: Boolean(virtualAccountObject),
      hasAccountId: this.hasObjectKey(accountObject, 'id'),
      hasAccountAccountId: this.hasObjectKey(accountObject, 'account_id'),
      hasAccountReference: this.hasObjectKey(accountObject, 'reference'),
      hasAccountAccountNumber: this.hasObjectKey(accountObject, 'account_number'),
      hasVirtualAccountId: this.hasObjectKey(virtualAccountObject, 'id'),
      hasVirtualAccountAccountId: this.hasObjectKey(virtualAccountObject, 'account_id'),
      hasVirtualAccountReference: this.hasObjectKey(virtualAccountObject, 'reference'),
      hasVirtualAccountAccountNumber: this.hasObjectKey(virtualAccountObject, 'account_number'),
      hasRootAccountNumberCamel: this.hasObjectKey(root, 'accountNumber'),
      hasRootAccountIdCamel: this.hasObjectKey(root, 'accountId'),
      hasAccountNumberCamel: this.hasObjectKey(accountObject, 'accountNumber'),
      hasAccountIdCamel: this.hasObjectKey(accountObject, 'accountId'),
      hasVirtualAccountNumberCamel: this.hasObjectKey(virtualAccountObject, 'accountNumber'),
      hasVirtualAccountIdCamel: this.hasObjectKey(virtualAccountObject, 'accountId'),
    };
  }

  private logVirtualAccountCreateResponseShape(input: {
    operation: string;
    endpoint: string;
    response: AxiosResponse<unknown>;
  }) {
    logger.info(
      'maplerad_virtual_account_create_response_shape',
      this.virtualAccountCreateResponseShape({
        operation: input.operation,
        endpoint: input.endpoint,
        httpStatus: input.response.status,
        providerRequestId: this.providerRequestId(input.response.headers),
        body: input.response.data,
      })
    );
  }

  private virtualAccountCollection(data: any): { key: MapleradVirtualAccountCollectionKey | null; items: MapleradVirtualAccount[] } {
    if (Array.isArray(data)) return { key: 'root', items: data };
    if (Array.isArray(data?.accounts)) return { key: 'accounts', items: data.accounts };
    if (Array.isArray(data?.items)) return { key: 'items', items: data.items };
    if (Array.isArray(data?.virtual_accounts)) return { key: 'virtual_accounts', items: data.virtual_accounts };
    return { key: null, items: [] };
  }

  getLastVirtualAccountListResponseShape() {
    return this.lastVirtualAccountListResponseShape;
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

  private normalizeDateOfBirthForTier1(value?: string | null) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return undefined;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
    if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) return trimmed;
    return undefined;
  }

  private splitNigerianPhone(value?: string | null) {
    const normalized = this.normalizeNigerianPhone(value);
    if (!normalized) return undefined;
    return {
      phone_country_code: '+234',
      phone_number: normalized.replace(/^\+234/, ''),
    };
  }

  private normalizeTier1Address(input?: string | Tier1AddressInput, fallback?: Partial<Tier1AddressInput>) {
    const objectInput = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const street = typeof input === 'string' ? input : objectInput.street;
    const address = {
      street: String(street || fallback?.street || '').trim(),
      street2: objectInput.street2 ?? null,
      city: String(objectInput.city || fallback?.city || '').trim(),
      state: String(objectInput.state || fallback?.state || '').trim(),
      country: String(objectInput.country || fallback?.country || 'NG').trim().toUpperCase(),
      postal_code: String(objectInput.postal_code || objectInput.postalCode || fallback?.postal_code || fallback?.postalCode || '').trim(),
    };
    return address;
  }

  private missingTier1Fields(input: {
    dob?: string;
    phone?: ReturnType<MapleRadService['splitNigerianPhone']>;
    address?: ReturnType<MapleRadService['normalizeTier1Address']>;
  }) {
    const missing: string[] = [];
    if (!input.dob) missing.push('dateOfBirth');
    if (!input.phone) missing.push('phoneNumber');
    if (!input.address?.street) missing.push('address');
    if (!input.address?.city) missing.push('city');
    if (!input.address?.state) missing.push('state');
    if (!input.address?.country) missing.push('country');
    if (!input.address?.postal_code) missing.push('postalCode');
    return missing;
  }

  private isTier1OrHigher(customer: MapleradCustomer) {
    const candidates = [customer.tier, customer.level, customer.account_tier, customer.customer_tier];
    return candidates.some((value) => {
      if (typeof value === 'number') return value >= 1;
      const normalized = String(value || '').trim().toLowerCase();
      return ['1', 'one', 'tier_1', 'tier1', 'tier 1', 'level_1', 'level1', 'level 1'].includes(normalized);
    });
  }

  private customerTierSnapshot(customer: MapleradCustomer) {
    return {
      tier: customer.tier,
      level: customer.level,
      account_tier: customer.account_tier,
      customer_tier: customer.customer_tier,
    };
  }

  async enrollMapleradCustomerTier1(
    userId: string,
    providerCustomerId?: string,
    input: Tier1UpgradeInput = {} as Tier1UpgradeInput,
    identity?: MapleradBvnVerificationResult['identity']
  ): Promise<MapleradTier1EnrollmentResult> {
    return AppDataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, userId);
      if (!user) throw new Error('User not found');
      const profile = await manager.getRepository(Profile).findOne({ where: { user: { id: user.id } } });
      const customerId = providerCustomerId || await this.ensureMapleRadCustomerForUser(user.id, manager);
      const beforeUpgrade = await this.getCustomerById(customerId);
      if (this.isTier1OrHigher(beforeUpgrade)) {
        await this.updateCustomerTierReference(manager, user, customerId, beforeUpgrade, 'tier1_confirmed', {
          tier1EnrollmentState: 'TIER_1',
        });
        return { customerId, customer: beforeUpgrade, upgraded: false, tier1: true, state: 'TIER_1' };
      }

      const dob = this.normalizeDateOfBirthForTier1(input.dateOfBirth || profile?.dateOfBirth || identity?.dateOfBirth);
      const phone = this.splitNigerianPhone(input.phoneNumber || identity?.phoneNumber || profile?.phoneNumber || user.phoneNumber);
      const address = this.normalizeTier1Address(input.address || profile?.address, {
        city: input.city || profile?.city,
        state: input.state || profile?.state,
        country: input.country || profile?.country || 'NG',
        postal_code: input.postalCode || input.postal_code || profile?.postalCode,
      });
      const missingFields = this.missingTier1Fields({ dob, phone, address });

      if (missingFields.length > 0 || !dob || !phone || !address) {
        await this.updateCustomerTierReference(manager, user, customerId, beforeUpgrade, 'tier1_profile_incomplete', {
          tier1EnrollmentState: 'PROFILE_INCOMPLETE',
          missingFields,
        });
        return {
          customerId,
          customer: beforeUpgrade,
          upgraded: false,
          tier1: false,
          state: 'PROFILE_INCOMPLETE',
          missingFields,
          code: 'MAPLERAD_TIER1_PROFILE_INCOMPLETE',
        };
      }

      await this.updateCustomerTierReference(manager, user, customerId, beforeUpgrade, 'tier1_processing', {
        tier1EnrollmentState: 'PROCESSING',
        missingFields: [],
      });

      try {
        await this.upgradeCustomerTier1({
          customer_id: customerId,
          dob,
          identification_number: input.bvn,
          phone,
          address,
          ...(input.photo ? { photo: input.photo } : {}),
        });
      } catch (error: any) {
        const retryable = isMapleradProviderError(error) && ['TIMEOUT', 'NETWORK', 'RATE_LIMIT', 'PROVIDER'].includes(error.code);
        await this.updateCustomerTierReference(manager, user, customerId, beforeUpgrade, retryable ? 'tier1_retrying' : 'tier1_failed', {
          tier1EnrollmentState: retryable ? 'RETRYING' : 'FAILED',
          lastTier1ProviderRequestId: isMapleradProviderError(error) ? error.requestId : undefined,
          lastTier1ProviderStatus: isMapleradProviderError(error) ? error.providerStatus : undefined,
          lastTier1ErrorCode: isMapleradProviderError(error) ? error.code : 'UNKNOWN',
        });
        await manager.getRepository(AuditLog).save(
          manager.getRepository(AuditLog).create({
            actorUserId: user.id,
            targetUserId: user.id,
            action: 'MAPLERAD_TIER1_ENROLLMENT_FAILED',
            entityType: 'ProviderReference',
            entityId: customerId,
            metadata: this.sanitizeProviderPayload({
              provider: 'maplerad',
              providerEnvironment: this.environment,
              state: retryable ? 'RETRYING' : 'FAILED',
              providerStatus: isMapleradProviderError(error) ? error.providerStatus : undefined,
              requestId: isMapleradProviderError(error) ? error.requestId : undefined,
            }),
          })
        );
        return {
          customerId,
          customer: beforeUpgrade,
          upgraded: false,
          tier1: false,
          state: retryable ? 'RETRYING' : 'FAILED',
          code: 'MAPLERAD_TIER1_ENROLLMENT_FAILED',
          providerStatus: isMapleradProviderError(error) ? error.providerStatus : undefined,
          providerMessage: isMapleradProviderError(error) ? error.providerMessage : undefined,
          requestId: isMapleradProviderError(error) ? error.requestId : undefined,
        };
      }

      const upgradedCustomer = await this.getCustomerById(customerId);
      const tier1 = this.isTier1OrHigher(upgradedCustomer);
      await this.updateCustomerTierReference(manager, user, customerId, upgradedCustomer, tier1 ? 'tier1_confirmed' : 'tier1_unconfirmed', {
        tier1EnrollmentState: tier1 ? 'TIER_1' : 'RECONCILIATION_REQUIRED',
      });

      await manager.getRepository(AuditLog).save(
        manager.getRepository(AuditLog).create({
          actorUserId: user.id,
          targetUserId: user.id,
          action: tier1 ? 'MAPLERAD_TIER1_ENROLLMENT_CONFIRMED' : 'MAPLERAD_TIER1_RECONCILIATION_REQUIRED',
          entityType: 'ProviderReference',
          entityId: customerId,
          metadata: {
            provider: 'maplerad',
            providerEnvironment: this.environment,
            state: tier1 ? 'TIER_1' : 'RECONCILIATION_REQUIRED',
          },
        })
      );

      return {
        customerId,
        customer: upgradedCustomer,
        upgraded: true,
        tier1,
        state: tier1 ? 'TIER_1' : 'RECONCILIATION_REQUIRED',
        code: tier1 ? undefined : 'MAPLERAD_TIER1_ENROLLMENT_FAILED',
      };
    });
  }

  async ensureCustomerTier1ForBvn(userId: string, input: Tier1UpgradeInput, identity?: MapleradBvnVerificationResult['identity']) {
    const result = await this.enrollMapleradCustomerTier1(userId, undefined, input, identity);
    if (result.state === 'PROFILE_INCOMPLETE') {
      throw new MapleradProviderError(
        'Tier 1 upgrade requires documented profile fields.',
        'maplerad.customer.upgrade_tier1.prepare',
        400,
        'missing tier 1 kyc fields',
        undefined,
        { missingFields: result.missingFields },
        'VALIDATION'
      );
    }
    if (!result.tier1) {
      throw new MapleradProviderError(
        'Maplerad customer is not Tier 1 after BVN upgrade.',
        'maplerad.customer.upgrade_tier1',
        result.providerStatus || 400,
        result.providerMessage || 'customer is not Tier 1 after upgrade',
        result.requestId,
        { state: result.state },
        'VALIDATION'
      );
    }
    return result;
  }

  private async updateCustomerTierReference(
    manager: EntityManager,
    user: User,
    customerId: string,
    customer: MapleradCustomer,
    status: string,
    metadata: Record<string, unknown> = {}
  ) {
    const repo = manager.getRepository(ProviderReference);
    const reference = await repo.findOne({ where: this.providerReferenceWhere(user.id) });
    const savedReference = reference || repo.create({
      user,
      userId: user.id,
      provider: 'maplerad',
      providerEnvironment: this.environment,
      referenceType: 'customer',
      providerCustomerId: customerId,
      externalReference: customerId,
    });
    savedReference.providerCustomerId = customerId;
    savedReference.externalReference = customerId;
    savedReference.status = status;
    savedReference.metadata = {
      ...(savedReference.metadata || {}),
      customerTier: this.customerTierSnapshot(customer),
      tier1VerifiedAt: status === 'tier1_confirmed' ? new Date().toISOString() : savedReference.metadata?.tier1VerifiedAt,
      ...this.sanitizeProviderPayload(metadata),
    };
    await repo.save(savedReference);
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
    return this.customerListFromEnvelope(data);
  }

  private customerListFromEnvelope(data: any): MapleradCustomer[] {
    const candidates = [
      data,
      data?.data,
      data?.data?.customers,
      data?.data?.items,
      data?.customers,
      data?.items,
      data?.result,
      data?.result?.customers,
      data?.result?.items,
    ];
    const list = candidates.find(Array.isArray);
    if (list) return list;
    throw new MapleradProviderError(
      'Maplerad customer list returned malformed response',
      'maplerad.customer.list_recovery',
      undefined,
      'missing customer list',
      undefined,
      this.sanitizeProviderPayload(data),
      'SCHEMA'
    );
  }

  private recoveryLimits() {
    const pageSize = Math.min(Math.max(Number(process.env.MAPLERAD_CUSTOMER_RECOVERY_PAGE_SIZE || 100), 1), 100);
    const maxPages = Math.min(Math.max(Number(process.env.MAPLERAD_CUSTOMER_RECOVERY_MAX_PAGES || 20), 1), 20);
    const maxRecords = Math.min(Math.max(Number(process.env.MAPLERAD_CUSTOMER_RECOVERY_MAX_RECORDS || 2000), 1), 2000);
    const timeoutMs = Math.min(Math.max(Number(process.env.MAPLERAD_CUSTOMER_RECOVERY_TIMEOUT_MS || 15000), 1000), 15000);
    const cooldownMs = Math.min(
      Math.max(Number(process.env.MAPLERAD_CUSTOMER_RECOVERY_COOLDOWN_MS || 15 * 60 * 1000), 60 * 1000),
      60 * 60 * 1000
    );
    return { pageSize, maxPages, maxRecords, timeoutMs, cooldownMs };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new MapleradProviderError(`${operation} timed out`, operation, undefined, 'recovery timeout', undefined, undefined, 'TIMEOUT')),
            timeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async listCustomersForRecovery() {
    const limits = this.recoveryLimits();
    const customers: MapleradCustomer[] = [];
    const requestIds: string[] = [];
    for (let page = 1; page <= limits.maxPages && customers.length < limits.maxRecords; page++) {
      const response = await this.withTimeout(
        this.requestMapleradRaw<any>({
          operation: 'maplerad.customer.list_recovery',
          method: 'GET',
          path: '/customers',
          params: { page, page_size: limits.pageSize },
        }),
        limits.timeoutMs,
        'maplerad.customer.list_recovery'
      );
      const pageCustomers = this.customerListFromEnvelope(response.data).slice(0, limits.maxRecords - customers.length);
      customers.push(...pageCustomers);
      const requestId = this.providerRequestId(response.headers);
      if (requestId) requestIds.push(requestId);
      logger.info('maplerad_customer_recovery_page_loaded', {
        providerEnvironment: this.environment,
        page,
        recordCount: pageCustomers.length,
        requestId,
      });
      if (pageCustomers.length < limits.pageSize) break;
    }
    return { customers, requestIds, limits };
  }

  private async activeRecoveryCooldown(userId: string, reason: string, identityFingerprint?: string) {
    const attempt = await AppDataSource.getRepository(MapleradCustomerRecoveryAttempt).findOne({
      where: { userId, providerEnvironment: this.environment, reason },
    });
    if (!attempt || attempt.expiresAt <= new Date()) return undefined;
    if (attempt.identityFingerprint !== identityFingerprint) return undefined;
    if (attempt.metadata?.parserVersion !== this.recoveryParserVersion()) return undefined;
    return attempt;
  }

  private async recordRecoveryAttempt(
    userId: string,
    reason: string,
    result: string,
    metadata: Record<string, unknown> = {}
  ) {
    const repo = AppDataSource.getRepository(MapleradCustomerRecoveryAttempt);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.recoveryLimits().cooldownMs);
    const existing = await repo.findOne({ where: { userId, providerEnvironment: this.environment, reason } });
    const attempt = existing || repo.create({ userId, providerEnvironment: this.environment, reason });
    attempt.result = result;
    attempt.attemptedAt = now;
    attempt.expiresAt = expiresAt;
    attempt.identityFingerprint = typeof metadata.identityFingerprint === 'string' ? metadata.identityFingerprint : attempt.identityFingerprint;
    attempt.metadata = this.sanitizeProviderPayload({ ...metadata, parserVersion: this.recoveryParserVersion() });
    await repo.save(attempt);
  }

  async discoverMatchingMapleradCustomers(user: User, manager?: EntityManager) {
    const { customers, requestIds, limits } = await this.listCustomersForRecovery();
    const exactMatches: Array<{ customer: MapleradCustomer; matchedFields: string[] }> = [];
    const partialMatches: Array<{ customerId?: string; mismatches: string[]; matchedFields: string[] }> = [];
    for (const customer of customers) {
      const customerId = customer.id || customer.customer_id;
      if (!customerId) continue;
      const match = await this.evaluateCustomerIdentityMatch(user, { ...customer, id: customerId }, manager);
      if (match.exact) exactMatches.push({ customer: { ...customer, id: customerId }, matchedFields: match.matchedFields });
      else if (match.matchedFields.length > 0) {
        logger.info('maplerad_customer_recovery_candidate_rejected', {
          user: this.maskedUserId(user.id),
          providerEnvironment: this.environment,
          matchedFields: match.matchedFields,
          mismatches: match.mismatches,
          identityAvailable: match.identityAvailable,
        });
        partialMatches.push({ customerId, mismatches: match.mismatches, matchedFields: match.matchedFields });
      }
    }
    return { exactMatches, partialMatches, scanned: customers.length, requestIds, limits };
  }

  async getCustomerVirtualAccounts(customerId: string): Promise<MapleradVirtualAccount[]> {
    const operation = 'maplerad.virtual_account.list_for_customer';
    const endpoint = `/customers/${customerId}/virtual-account`;
    const safeEndpoint = '/customers/{customerId}/virtual-account';
    const response = await this.requestMapleradRaw<any>({
      operation,
      method: 'GET',
      path: endpoint,
      logPath: safeEndpoint,
    });
    const body = response.data;
    const data: any = this.unwrap(response);
    const collection = this.virtualAccountCollection(data);
    this.lastVirtualAccountListResponseShape = {
      operation,
      endpoint: safeEndpoint,
      httpStatus: response.status,
      providerRequestId: this.providerRequestId(response.headers),
      topLevelKeys: this.objectKeys(body),
      dataLevelKeys: this.objectKeys((body as any)?.data),
      nestedDataLevelKeys: this.objectKeys((body as any)?.data?.data),
      bodyIsArray: Array.isArray(body),
      unwrappedIsArray: Array.isArray(data),
      recognizedCollectionKey: collection.key,
      recognizedCollectionLength: collection.items.length,
      firstCollectionItemKeys: collection.items.length ? this.objectKeys(collection.items[0]) : [],
    };
    logger.info('maplerad_virtual_account_response_shape', this.lastVirtualAccountListResponseShape);
    if (collection.key) return collection.items;
    return [];
  }

  private findProviderVirtualAccount(accounts: MapleradVirtualAccount[], currency: Currency) {
    return accounts.find((account) => {
      const accountCurrency = String(account.currency || '').toUpperCase();
      return accountCurrency === currency && Boolean(account.account_number);
    });
  }

  private findUniqueProviderVirtualAccount(accounts: MapleradVirtualAccount[], currency: Currency) {
    const matches = accounts.filter((account) => {
      const accountCurrency = String(account.currency || '').toUpperCase();
      return accountCurrency === currency && Boolean(this.accountId(account));
    });
    if (matches.length > 1) {
      throw new MapleradCustomerRecoveryError(
        'MAPLERAD_CUSTOMER_RECONCILIATION_REQUIRED',
        `Multiple Maplerad ${currency} accounts require admin reconciliation.`,
        'ADMIN_RECONCILIATION_REQUIRED'
      );
    }
    return matches[0];
  }

  private applyVirtualAccountToWallet(wallet: Wallet, data: MapleradVirtualAccount, currency: Currency) {
    wallet.mapleradAccountId = data.id || data.account_id;
    wallet.accountNumber = data.account_number;
    wallet.bankName = data.bank_name || data.bank?.name;
    wallet.currency = currency;
    return wallet;
  }

  private walletResponse(wallet: Wallet) {
    return {
      id: wallet.id,
      currency: wallet.currency,
      availableBalance: Number(wallet.availableBalance || 0),
      pendingBalance: Number(wallet.pendingBalance || 0),
      ledgerBalance: Number(wallet.ledgerBalance || wallet.balance || 0),
      accountNumber: wallet.accountNumber ? this.maskAccountNumber(wallet.accountNumber) : undefined,
      bankName: wallet.bankName,
      status: wallet.usdAccountStatus && wallet.currency === 'USD' ? wallet.usdAccountStatus : 'active',
      providerEnvironment: this.environment,
    };
  }

  public formatWalletForClient(wallet: Wallet) {
    return this.walletResponse(wallet);
  }

  private maskAccountNumber(accountNumber?: string | null) {
    const value = String(accountNumber || '').replace(/\D/g, '');
    if (!value) return undefined;
    return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
  }

  private accountId(data: MapleradVirtualAccount) {
    return data.id || data.account_id || data.reference;
  }

  private async upsertWalletAndAccountReference(
    manager: EntityManager,
    user: User,
    customerId: string,
    data: MapleradVirtualAccount,
    currency: Currency
  ) {
    const walletRepo = manager.getRepository(Wallet);
    const referenceRepo = manager.getRepository(ProviderReference);
    const existingWallet = await walletRepo.findOne({ where: { user: { id: user.id }, currency } });
    const existingReference = await referenceRepo.findOne({ where: this.providerAccountReferenceWhere(user.id, currency) });
    const providerAccountId = this.accountId(data);
    if (!providerAccountId) {
      throw new MapleradProviderError(
        'Maplerad virtual account response did not include an account id',
        'maplerad.virtual_account.persist',
        undefined,
        'missing account id',
        undefined,
        this.sanitizeProviderPayload(data),
        'SCHEMA'
      );
    }
    if (existingWallet?.mapleradAccountId && existingWallet.mapleradAccountId !== providerAccountId) {
      throw new MapleradProviderError(
        `Local ${currency} wallet is linked to a different Maplerad account`,
        'maplerad.virtual_account.persist',
        409,
        'local wallet account conflict',
        undefined,
        { currency },
        'VALIDATION'
      );
    }
    if (existingReference?.providerAccountId && existingReference.providerAccountId !== providerAccountId) {
      throw new MapleradProviderError(
        `Local ${currency} provider reference is linked to a different Maplerad account`,
        'maplerad.virtual_account.persist',
        409,
        'local provider reference account conflict',
        undefined,
        { currency },
        'VALIDATION'
      );
    }

    const wallet = this.applyVirtualAccountToWallet(existingWallet || walletRepo.create({ user }), data, currency);
    if (currency === 'USD') {
      wallet.usdAccountId = providerAccountId;
      wallet.usdAccountStatus = String(data.status || existingWallet?.usdAccountStatus || 'pending') as any;
    }
    await walletRepo.save(wallet);

    const savedReference = existingReference || referenceRepo.create({
      user,
      userId: user.id,
      provider: 'maplerad',
      providerEnvironment: this.environment,
      referenceType: 'account',
      currency,
    });
    savedReference.providerCustomerId = customerId;
    savedReference.externalReference = providerAccountId;
    savedReference.providerAccountId = providerAccountId;
    savedReference.accountNumber = data.account_number;
    savedReference.bankName = data.bank_name || data.bank?.name;
    savedReference.currency = currency;
    savedReference.status = String(data.status || 'active');
    savedReference.metadata = { accountStatus: data.status };
    await referenceRepo.save(savedReference);
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
      let reference = await referenceRepo.findOne({ where: this.providerAccountReferenceWhere(user.id, currency) });
      if (existingWallet?.accountNumber && existingWallet?.mapleradAccountId && reference?.providerAccountId) return existingWallet;

      const customerId = await this.ensureMapleRadCustomerForUser(user.id, manager);
      const customer = await this.getCustomerById(customerId);
      if (!this.isTier1OrHigher(customer)) {
        await this.updateCustomerTierReference(manager, user, customerId, customer, 'tier1_required');
        throw new MapleradProviderError(
          'Customer must complete Tier 1 KYC before a NGN virtual account can be created.',
          'maplerad.virtual_account.preflight_tier1',
          400,
          'service is only available for Tier 1 customers',
          undefined,
          this.customerTierSnapshot(customer),
          'VALIDATION'
        );
      }
      reference = await referenceRepo.findOne({ where: this.providerAccountReferenceWhere(user.id, currency) });
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
      let data = this.findUniqueProviderVirtualAccount(providerAccounts, currency);
      let createDiagnostics: { operation: string; endpoint: string } | undefined;

      if (!data) {
        const operation = 'maplerad.virtual_account.create';
        const endpoint = '/collections/virtual-account';
        createDiagnostics = { operation, endpoint };
        const payload = { customer_id: customerId, currency, preferred_bank: process.env.MAPLERAD_NGN_PREFERRED_BANK };
        if (!payload.preferred_bank) delete (payload as Partial<typeof payload>).preferred_bank;
        const response = await this.requestMapleradRaw<MapleradVirtualAccount>({
          operation,
          method: 'POST',
          path: endpoint,
          payload,
          onErrorResponse: (errorResponse) => this.logVirtualAccountCreateResponseShape({ operation, endpoint, response: errorResponse }),
        });
        logger.info('maplerad_virtual_account_create_received', {
          operation,
          endpoint,
          httpStatus: response.status,
          providerRequestId: this.providerRequestId(response.headers),
        });
        this.logVirtualAccountCreateResponseShape({ operation, endpoint, response });
        data = this.unwrap<MapleradVirtualAccount>(response);
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
      if (createDiagnostics) {
        logger.info('maplerad_virtual_account_parse_succeeded', createDiagnostics);
      }

      if (createDiagnostics) {
        logger.info('maplerad_virtual_account_persist_started', createDiagnostics);
      }
      const wallet = await this.upsertWalletAndAccountReference(manager, user, customerId, data, currency);
      if (createDiagnostics) {
        logger.info('maplerad_virtual_account_persist_succeeded', createDiagnostics);
      }
      return wallet;
    });
  }

  async createUsdVirtualAccount(userId: string): Promise<Wallet> {
    return AppDataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, userId);
      if (!user) throw new Error('User not found');

      const currency: Currency = 'USD';
      const walletRepo = manager.getRepository(Wallet);
      const referenceRepo = manager.getRepository(ProviderReference);
      const existingWallet = await walletRepo.findOne({ where: { user: { id: user.id }, currency } });
      const existingReference = await referenceRepo.findOne({ where: this.providerAccountReferenceWhere(user.id, currency) });
      if (existingWallet?.mapleradAccountId && existingReference?.providerAccountId) return existingWallet;

      const customerId = await this.ensureMapleRadCustomerForUser(user.id, manager);
      const providerAccounts = await this.getCustomerVirtualAccounts(customerId);
      let data = this.findUniqueProviderVirtualAccount(providerAccounts, currency);

      if (!data) {
        data = await this.requestMaplerad<MapleradVirtualAccount>({
          operation: 'maplerad.virtual_account.create_usd',
          method: 'POST',
          path: '/collections/virtual-account/usd',
          payload: {
            customer_id: customerId,
            meta: {
              first_name: user.firstName,
              last_name: user.lastName,
              email: user.email,
              country: 'NG',
            },
          },
        });
      }

      if (!this.accountId(data)) {
        throw new MapleradProviderError(
          'USD account request did not return an account id or reference',
          'maplerad.virtual_account.create_usd',
          undefined,
          'missing account id',
          undefined,
          this.sanitizeProviderPayload(data),
          'SCHEMA'
        );
      }

      return this.upsertWalletAndAccountReference(manager, user, customerId, data, currency);
    });
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
