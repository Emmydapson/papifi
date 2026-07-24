# Papafi Backend

Papafi is an Express/TypeScript fintech backend using PostgreSQL and TypeORM.

## Current Stack

- Node.js, Express, TypeScript
- PostgreSQL with TypeORM migrations
- JWT authentication
- Resend API email delivery with optional SMTP provider
- Maplerad for wallet, virtual account, transfer, card, webhook, and BVN verification flows

## KYC

Papafi no longer uses Dojah for active KYC verification.

Current Phase 1 KYC behavior:

- BVN verification is performed through Maplerad.
- Document metadata/uploads can be collected for NIN, driver's license, international passport, and voter's card.
- Document OCR and automated document verification are not implemented in Phase 1.
- `GET /api/kyc/status` returns one sanitized current summary per KYC type. It does not return raw provider responses, full names, date of birth, phone numbers, BVN, document numbers, upload URLs, selfie URLs, or identity images.
- BVN equality checks use `HMAC_SHA256(BVN_FINGERPRINT_SECRET, normalizedBvn)` so repeated verification of the same already-passed BVN can be idempotent without storing the BVN in plaintext.
- Maplerad BVN success is accepted only for a successful HTTP response with body `status: true` and a `data` object. Provider validation, authentication, insufficient-balance, malformed-response, and outage errors are returned as safe provider errors instead of failed BVN verification results.

## Required Environment Variables

See `.env.example` for the full list.

Important production requirements:

- `JWT_SECRET`
- `SESSION_SECRET`
- PostgreSQL connection variables
- `EMAIL_PROVIDER` (`resend` or `smtp`)
- `RESEND_API_KEY` when `EMAIL_PROVIDER=resend`, or SMTP connection variables when `EMAIL_PROVIDER=smtp`
- `SMTP_FROM_EMAIL` (the sender address for either provider)
- `MAPLERAD_ENVIRONMENT` (`sandbox` or `production`)
- `MAPLERAD_SANDBOX_SECRET_KEY` for sandbox, or `MAPLERAD_PRODUCTION_SECRET_KEY` for production
- `MAPLERAD_WEBHOOK_VERIFICATION_MODE` (`signature`, `ip_and_requery`, or `disabled`)
- `MAPLERAD_SANDBOX_WEBHOOK_SECRET` for sandbox, or `MAPLERAD_PRODUCTION_WEBHOOK_SECRET` for production, only when Maplerad provides the endpoint signing secret
- `BVN_FINGERPRINT_SECRET` with at least 32 random characters. It is required in production and must not be logged or shared.
- `CORS_ALLOWED_ORIGINS`

Do not commit `.env`, private keys, PEM files, or provider credentials.

## Email Delivery

Resend is the recommended provider because it sends mail over HTTPS rather than SMTP:

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_your_api_key
SMTP_FROM_EMAIL=noreply@mail.papifi.com
EMAIL_HTTP_TIMEOUT_MS=10000
```

The sender address or domain must be verified in Resend. To use the legacy SMTP path explicitly, set `EMAIL_PROVIDER=smtp` and configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS`. SMTP is not initialized or used when the provider is `resend`.

## Maplerad Environments

Papafi resolves Maplerad settings centrally with `MAPLERAD_ENVIRONMENT`.

Sandbox and production use the same official Maplerad API host, normalized by the backend to:

```text
https://api.maplerad.com/v1
```

The environments are separated by keys and by Papafi provider-reference records:

- `MAPLERAD_ENVIRONMENT=sandbox` uses `MAPLERAD_SANDBOX_BASE_URL`, `MAPLERAD_SANDBOX_SECRET_KEY`, and `MAPLERAD_SANDBOX_WEBHOOK_SECRET`.
- `MAPLERAD_ENVIRONMENT=production` uses `MAPLERAD_PRODUCTION_BASE_URL`, `MAPLERAD_PRODUCTION_SECRET_KEY`, and `MAPLERAD_PRODUCTION_WEBHOOK_SECRET`.

Development, test, and staging default to sandbox. Production defaults to production. A production Node process refuses `MAPLERAD_ENVIRONMENT=sandbox` unless `MAPLERAD_ALLOW_PRODUCTION_SANDBOX=true` is set for a temporary non-live deployment.

Changing provider environments does not migrate provider customer IDs, wallet IDs, account numbers, KYC state, or webhook event IDs. Sandbox and production provider IDs are stored separately as `maplerad:sandbox` and `maplerad:production` references.

### Maplerad Webhooks

Maplerad webhook signing is separate from API authentication:

- API secret keys authenticate Papafi's outgoing API requests to Maplerad.
- API public keys are not webhook signing secrets.
- Webhook signature verification requires the endpoint-specific signing secret from Maplerad, beginning with `whsec_`.
- Do not generate a local `whsec_` for production; Maplerad would not sign with it.

Use:

```text
MAPLERAD_WEBHOOK_VERIFICATION_MODE=signature
MAPLERAD_SANDBOX_WEBHOOK_SECRET=whsec_...
MAPLERAD_PRODUCTION_WEBHOOK_SECRET=whsec_...
```

If the dashboard does not show a `whsec_...` signing secret for the webhook endpoint, contact Maplerad support or recreate/configure the webhook endpoint until the signing secret is available. Keep the secret out of logs.

Temporary fallback:

```text
MAPLERAD_WEBHOOK_VERIFICATION_MODE=ip_and_requery
MAPLERAD_WEBHOOK_ALLOWED_IPS=54.216.8.72,54.173.54.49,52.215.16.239,52.55.123.25,52.6.93.106,63.33.109.123,44.228.126.217,50.112.21.217,52.24.126.164,54.148.139.208
MAPLERAD_TRUST_PROXY=loopback
```

`ip_and_requery` is not equivalent to signature verification. It accepts only Maplerad's documented webhook source IPs and re-queries Maplerad before applying customer value. Use it only while waiting for the real `whsec_...` secret.

`MAPLERAD_WEBHOOK_VERIFICATION_MODE=disabled` is allowed only for local development and automated tests. It is rejected in production and does not process real provider events.

## Security Notes

Phase 1 includes:

- Crypto-secure, hashed OTP storage
- Password reset requiring a valid issued reset OTP
- Authenticated transaction PIN creation for the current user only
- Basic in-memory rate limiting
- Ownership checks for wallets, cards, and transactions
- Maplerad webhook signature verification using raw request body
- Webhook idempotency table and indexes
- Basic balance checks before withdrawals and card funding
- Card PAN/CVV are not persisted or returned by API responses
- Strict env-based CORS

## Ledger And Wallet Correctness

Phase 2 adds immutable ledger tables:

- `ledger_account`
- `ledger_journal`
- `ledger_entry`

Money movement now posts balanced journals where total debits equal total credits. Wallets also track `availableBalance`, `pendingBalance`, and `ledgerBalance`; legacy currency balance columns remain for API compatibility and are updated only through ledger service operations.

Current wallet flows:

- Deposits are credited through Maplerad webhook provider references.
- Withdrawals and card funding move funds from available balance into provider suspense before the provider call.
- Provider call failures reverse pending holds.
- Internal transfers debit one wallet and credit another in one database transaction.
- User-initiated money movement supports idempotency through the `Idempotency-Key` header or `idempotencyKey` body field.

The Phase 2 migration creates opening-balance journals from existing wallet balances so historical balances have an auditable ledger starting point.

## Limits, Risk, Audit, And Reconciliation

Phase 3 adds operational controls around the ledger.

Audit logs:

- Stored in `audit_log`.
- Immutable at ORM and database trigger level.
- Capture actor, target, action, entity, IP, user agent, and sanitized metadata.
- Secret-like fields such as OTP, PIN, password, token, PAN, and CVV are redacted.

Account tiers:

- `UNVERIFIED`
- `BVN_VERIFIED`
- `DOCUMENT_SUBMITTED`
- `APPROVED`

Limits are enforced before debit holds for withdrawals, transfers, and card funding. Defaults are defined in `limitService.ts`; `UNVERIFIED` users cannot debit funds. Daily withdrawal, transfer, card funding, and total debit checks are applied by tier.

Risk controls:

- Failed PIN attempts create risk flags.
- Large transactions are flagged.
- New-account high-value movement is flagged.
- Withdrawal/transfer velocity is flagged.
- Duplicate idempotency reuse is flagged as low severity.

Reconciliation:

- Provider transactions track `lastCheckedAt`, `reconciledAt`, `reconciliationStatus`, and `reconciliationNotes`.
- `reconciliationService` finds stale `PROCESSING` or `PENDING` Maplerad transactions.
- Successful provider status settles pending holds.
- Failed/reversed provider status reverses pending holds.
- Unknown or missing provider responses stay pending or move to manual review.

Admin/risk endpoints:

- `GET /api/admin/audit-logs`
- `GET /api/admin/risk-flags`
- `GET /api/admin/reconciliation`
- `POST /api/admin/transactions/:id/manual-review`
- `GET /api/admin/users/:userId/wallet-summary`

These routes require an authenticated `admin` or `super_admin`.

Manual operational checklist:

- Run migrations before deploying app code that writes Phase 3 fields.
- Review open risk flags daily.
- Review reconciliation queue for stale provider transactions.
- Investigate `MANUAL_REVIEW` transactions before manual settlement.
- Rotate and audit provider keys separately from app deploys.

## Current Limitations

Remaining ledger/compliance work:

- Full provider reconciliation coverage for every Maplerad product event type
- Multi-instance distributed worker locking if the API is deployed with multiple active instances
- External log aggregation, metrics, alerting, and incident runbooks

## Production Readiness

Phase 4 adds:

- DB-level immutability triggers for `audit_log`, `ledger_journal`, and `ledger_entry`.
- Structured JSON logs with request IDs.
- `GET /health` liveness and `GET /ready` database readiness endpoints.
- Optional scheduled reconciliation worker.
- Docker, Docker Compose, PM2, GitHub Actions CI, and OpenAPI docs.
- PostgreSQL integration tests that run when `POSTGRES_TEST_DATABASE_URL` is set.

### Reconciliation Worker

The worker is disabled by default. Enable it for a single staging/production instance:

```bash
RECONCILIATION_WORKER_ENABLED=true
RECONCILIATION_WORKER_INTERVAL_MS=300000
RECONCILIATION_STALE_MINUTES=30
```

The current worker uses an in-process skip-if-running guard. For multi-instance deployments, run it on exactly one instance or replace it with a distributed lock before enabling it everywhere.

### API Documentation

OpenAPI route documentation is in `docs/openapi.yaml`.

Important API requirements:

- Authenticated routes require `Authorization: Bearer <jwt>`.
- Withdrawals, transfers, card funding, and card withdrawal require `Idempotency-Key`.
- Maplerad webhooks require the configured signature header over the raw request body.
- KYC uses Maplerad BVN verification plus document metadata collection for NIN, driver's license, international passport, and voter's card.

## Commands

```bash
npm run build
npm test
npm run migration:show
npm run migration:run
npm run kyc:sanitize:dry-run
npm start
```

Production deployment order:

```bash
npm run build
npm run migration:show
npm run migration:run
pm2 restart papafi-backend --update-env
```

`GET /ready` checks for pending TypeORM migrations and returns `schema_not_ready` until the configured database schema is current.

Wallet user routes keep their existing `:userId` path for compatibility. Normal users may access only their own user ID; `admin` and `super_admin` roles may act on another user.

KYC metadata remediation:

```bash
npm run kyc:sanitize:dry-run
npm run kyc:sanitize
```

The dry-run reports counts and suspicious historical `FAILED` KYC IDs only. The write command transactionally removes raw KYC provider/document metadata and is safe to run more than once. It does not change historical verification statuses.

Migration inspection:

```bash
npm run migration:show
npm run migration:revert
```

PostgreSQL integration tests:

```bash
POSTGRES_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/papafi_test npm test
```

Without `POSTGRES_TEST_DATABASE_URL`, integration tests are skipped and unit/service tests still run.

## Staging Deployment

Docker Compose local/staging path:

```bash
cp .env.example .env
docker compose up --build
```

Manual VM/PM2 path:

```bash
npm ci
npm run build
npm run migration:run
pm2 start ecosystem.config.js
```

Readiness checks:

```bash
curl http://localhost:5000/health
curl http://localhost:5000/ready
```

## Rollback Notes

- Prefer rolling back application code first if a deployment fails before migrations have written new production data.
- Use `npm run migration:revert` only after confirming the target migration is safe to reverse for current data.
- Do not manually update or delete `audit_log`, `ledger_journal`, or `ledger_entry`; database triggers intentionally block this.
- Keep provider keys, JWT secret, and session secret rotation separate from app rollback unless the incident requires credential rotation.

## Remaining Launch Checklist

- Run migrations on a staging copy of production data.
- Verify `/ready` through the load balancer or reverse proxy.
- Confirm `CORS_ALLOWED_ORIGINS` exactly matches frontend origins.
- Confirm `RECONCILIATION_WORKER_ENABLED=true` is set on only one active instance.
- Configure centralized log collection for JSON logs.
- Configure database backups and restore drills.
- Verify Maplerad webhook URL and signature secret in the Maplerad dashboard.
- Review open risk flags and reconciliation queue before launch.

## Phase 1 Manual Verification Checklist

- `npm run build` passes.
- Password reset without `otp` is rejected.
- Password reset with an expired, missing, or wrong-purpose OTP is rejected.
- Password reset clears the OTP only after a successful reset.
- `POST /api/auth/create-pin` without a JWT returns `401`.
- Authenticated PIN creation updates only the JWT user.
- User A cannot read User B's wallet balance, card, or transaction history by passing User B IDs.
- Withdrawal and card funding require a valid transaction PIN.
- Withdrawal and card funding reject insufficient wallet balances.
- Replaying the same Maplerad webhook event ID returns success without applying the event twice.
- Active source code contains no Dojah service, Dojah webhook, or Dojah env dependency.
