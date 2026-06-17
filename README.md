# Papafi Backend

Papafi is an Express/TypeScript fintech backend using PostgreSQL and TypeORM.

## Current Stack

- Node.js, Express, TypeScript
- PostgreSQL with TypeORM migrations
- JWT authentication
- SMTP email OTP
- Maplerad for wallet, virtual account, transfer, card, webhook, and BVN verification flows

## KYC

Papafi no longer uses Dojah for active KYC verification.

Current Phase 1 KYC behavior:

- BVN verification is performed through Maplerad.
- Document metadata/uploads can be collected for NIN, driver's license, international passport, and voter's card.
- Document OCR and automated document verification are not implemented in Phase 1.

## Required Environment Variables

See `.env.example` for the full list.

Important production requirements:

- `JWT_SECRET`
- `SESSION_SECRET`
- PostgreSQL connection variables
- SMTP variables
- `MAPLERAD_SECRET_KEY`
- `MAPLERAD_PUBLIC_KEY`
- `MAPLERAD_WEBHOOK_SECRET`
- `CORS_ALLOWED_ORIGINS`

Do not commit `.env`, private keys, PEM files, or provider credentials.

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
npm run migration:run
npm start
```

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
