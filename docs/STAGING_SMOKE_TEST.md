# Papafi Staging Smoke Test

This smoke test exercises deployed Papafi API endpoints from a frontend/mobile integration perspective without moving real money.

## Required Env Vars

| Env var | Required | Purpose |
| --- | --- | --- |
| `STAGING_BASE_URL` | Yes | API base URL, for example `https://api-staging.papifi.com`, `https://api.papifi.com`, or `http://localhost:5000`. |
| `SMOKE_TEST_EMAIL` | For registration/auth flows | Real operator-controlled inbox. The script does not generate fake recipients and rejects reserved domains such as `example.com`, `example.org`, `example.net`, `test.com`, and `localhost`. |
| `SMOKE_TEST_PHONE` | For registration/auth flows | Explicit E.164 phone number, for example `+2348012340000`. The script does not generate random production phone numbers. |

## Optional Env Vars

| Env var | Purpose |
| --- | --- |
| `TEST_OTP`, `DEV_TEST_OTP`, or `SMOKE_TEST_OTP` | Automates account OTP verification when staging has a safe test OTP bypass. |
| `ENABLE_TEST_OTP_BYPASS` | Backend-only staging/dev flag. Set to `true` outside production to bypass SMTP and use `TEST_OTP_CODE`. Defaults to disabled. |
| `TEST_OTP_CODE` | Backend staging/dev OTP code used only when `ENABLE_TEST_OTP_BYPASS=true` and `NODE_ENV` is not `production`. The smoke test also reads this as an OTP input when provided. |
| `TEST_USER_TOKEN` | Skips registration, OTP verification, and login; continues authenticated checks with an existing normal user token. |
| `TEST_USER_ID` | Required only when `TEST_USER_TOKEN` cannot be decoded locally. |
| `SMOKE_TEST_EMAIL_PREFIX` | Optional plus-addressing tag prefix. Used only with `SMOKE_TEST_RUN_ID`/generated run id to create `base+prefix-runid@domain`. Set only when the supplied inbox/domain supports plus-addressing. |
| `SMOKE_TEST_RUN_ID` | Optional stable run id for plus-addressing and webhook mock IDs. |
| `SMOKE_TEST_PASSWORD` | Overrides generated test password. Do not use a real user password. |
| `SMOKE_TEST_PIN` | Overrides the test transaction PIN. Do not use a real user PIN. |
| `MAPLERAD_LIVE_TESTS_ENABLED` | Must be `true` before the smoke test calls live provider-affecting KYC or virtual-account routes. Defaults to skipped. |
| `MAPLERAD_LIVE_TEST_CUSTOMER_EMAIL`, `MAPLERAD_LIVE_TEST_PHONE`, `MAPLERAD_LIVE_TEST_BVN` | Enables BVN KYC check with explicit authorized test identity data. |
| `MAPLERAD_WEBHOOK_SECRET` or `SMOKE_MAPLERAD_WEBHOOK_SECRET` | Enables signed mock Maplerad webhook and duplicate webhook checks. |

Do not use fake recipient domains such as `example.com` or `test.com`. Resend rejects those recipients. Use an operator-controlled inbox only, and use plus-addressing only when that inbox/domain is known to support it.

The deployed email sender must use the verified domain:

```text
SMTP_FROM_EMAIL=noreply@mail.papifi.com
```

## How To Run

Against deployed staging:

```powershell
$env:STAGING_BASE_URL = "https://api-staging.papifi.com"
$env:SMOKE_TEST_EMAIL = "operator-controlled-inbox@your-verified-domain.tld"
$env:SMOKE_TEST_PHONE = "+2348012340000"
$env:ENABLE_TEST_OTP_BYPASS = "true"
$env:TEST_OTP_CODE = "<safe-dev-otp-code>"
$env:MAPLERAD_WEBHOOK_SECRET = "<staging-webhook-secret>"
npm run smoke:staging
```

With explicit plus-addressing:

```powershell
$env:STAGING_BASE_URL = "https://api-staging.papifi.com"
$env:SMOKE_TEST_EMAIL = "operator-controlled-inbox@your-verified-domain.tld"
$env:SMOKE_TEST_EMAIL_PREFIX = "papafi"
$env:SMOKE_TEST_RUN_ID = "20260719-01"
$env:SMOKE_TEST_PHONE = "+2348012340000"
npm run smoke:staging
```

This registers `operator-controlled-inbox+papafi-20260719-01@your-verified-domain.tld`. Do not set `SMOKE_TEST_EMAIL_PREFIX` or `SMOKE_TEST_RUN_ID` unless the inbox supports plus-addressing. Without those variables, the script uses `SMOKE_TEST_EMAIL` exactly as supplied.

Against local backend:

```powershell
$env:STAGING_BASE_URL = "http://localhost:5000"
npm run smoke:staging
```

With an existing normal user token:

```powershell
$env:STAGING_BASE_URL = "https://api-staging.papifi.com"
$env:TEST_USER_TOKEN = "<normal-user-jwt>"
npm run smoke:staging
```

When `SMOKE_TEST_EMAIL` is absent and no `TEST_USER_TOKEN` is supplied, the script runs only unauthenticated safe checks, skips registration/OTP/login/PIN/KYC/wallet/transaction/admin checks, and does not call the email provider.

## Expected Output

The script prints one line per step:

```text
- GET /health ... PASS
- GET /ready ... PASS
- POST /api/auth/register ... PASS
- POST /api/auth/verify-otp ... PASS
...
PASS   Admin endpoints reject normal user token
Elapsed: 8.4s
```

Failures include the endpoint, status code, and sanitized response body. Sensitive fields such as tokens, OTPs, PINs, BVNs, signatures, passwords, account numbers, PANs, and CVVs are redacted from output.
Email addresses and phone numbers are masked in console output.

Email-provider failures are classified as:

| Code | Meaning |
| --- | --- |
| `TEST_DATA_INVALID` | Resend rejected a reserved or invalid recipient, commonly status `422` invalid `to`. |
| `EMAIL_PROVIDER_AUTH_FAILED` | Resend/API credentials are missing, invalid, revoked, or unauthorized. |
| `EMAIL_SENDER_NOT_VERIFIED` | The configured sender/domain is not verified. Confirm `SMTP_FROM_EMAIL` uses `mail.papifi.com`. |
| `EMAIL_PROVIDER_UNAVAILABLE` | Network, timeout, or provider availability failure. |

## Manual OTP Fallback

If no safe OTP bypass is configured, the script registers the provided test inbox, stops after registration, and prints a manual action:

```text
MANUAL POST /api/auth/verify-otp - No TEST_OTP/DEV_TEST_OTP/SMOKE_TEST_OTP provided...
```

Then either:

- retrieve the OTP through the approved staging email/test channel and rerun with `TEST_OTP`, or
- log in through an approved test path and rerun with `TEST_USER_TOKEN`.

The script intentionally does not scrape email inboxes or print OTPs.

For staging/dev environments without SMTP, configure the backend with:

```text
NODE_ENV=development
ENABLE_TEST_OTP_BYPASS=true
TEST_OTP_CODE=<safe-dev-otp-code>
```

The bypass is ignored when `NODE_ENV=production`. It is intended only for Papafi smoke tests and staging/dev verification.

## Covered Endpoints

The script covers:

- `GET /health`
- `GET /ready`
- `POST /api/auth/register`
- `POST /api/auth/verify-otp` when a safe OTP is supplied
- `POST /api/auth/login`
- `POST /api/auth/create-pin`
- `POST /api/kyc/bvn` when a sandbox BVN is supplied
- `POST /api/kyc/documents`
- `POST /api/wallet/create/{userId}`
- `POST /api/wallet/create-usd/{userId}`
- `GET /api/wallet/balance/{userId}`
- `GET /api/transaction`
- `POST /api/wallet/withdraw` only to verify the missing `Idempotency-Key` guard before money movement
- `POST /api/wallet/webhook` signed mock event when a webhook secret is supplied
- `POST /api/wallet/webhook` duplicate signed mock event when a webhook secret is supplied
- `GET /api/admin/audit-logs`
- `GET /api/admin/risk-flags`
- `GET /api/admin/reconciliation`
- `POST /api/admin/transactions/{id}/manual-review`
- `GET /api/admin/users/{userId}/wallet-summary`

Admin endpoints are expected to return `401` or `403` for a normal user token.

## Maplerad Sandbox Notes

BVN KYC is tested only when `MAPLERAD_LIVE_TESTS_ENABLED=true` and all authorized live test identity variables are supplied. Use only explicit test identity values approved for staging/live verification.

The webhook test does not use a provider-private payload and does not simulate a deposit. It sends a signed non-money mock event (`smoke.test`) to confirm:

- the backend accepts a correctly signed callback,
- the event is recorded,
- sending the same event again returns duplicate-safe behavior.

The smoke test does not:

- create real withdrawals,
- fund or withdraw from virtual cards,
- call Maplerad directly from the script,
- expose or require live Maplerad keys.

## Safety Guarantees

- No real money movement is triggered.
- Withdrawal is called without `Idempotency-Key` and is expected to fail before ledger/provider submission.
- Tokens, OTPs, PINs, BVNs, account numbers, passwords, signatures, PANs, and CVVs are redacted from logs.
- The script fails fast with endpoint, status code, and sanitized response when an unexpected result occurs.
