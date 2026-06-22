# Papafi Frontend API Reference

This reference documents the implemented Express routes in this backend for web, mobile, and admin frontend integration.

## Base URLs

| Environment | Base URL |
| --- | --- |
| Staging | `https://api-staging.papifi.com` |
| Production | `https://api.papifi.com` |
| Local | `http://localhost:5000` |

The backend source defaults to `PORT=5000` when `PORT` is not configured. Use the deployed or local base URL provided by the environment you are testing.

## Required Headers

| Header | Required | Used by | Notes |
| --- | --- | --- | --- |
| `Content-Type: application/json` | Yes for JSON requests | All JSON endpoints | Webhook signing depends on the exact raw JSON body received by the server. |
| `Authorization: Bearer <jwt>` | Yes for authenticated routes | Profile, KYC, wallet, cards, transactions, admin | JWT is returned by account OTP verification and login. |
| `Idempotency-Key: <unique-key>` | Yes for money movement | Withdrawals, internal transfers, card funding, card withdrawal | Minimum 8 characters. The backend also accepts `idempotencyKey` in the JSON body as a fallback. |
| `x-maplerad-signature` | Yes | `POST /api/wallet/webhook` | Provider callback only. Header name can be changed with `MAPLERAD_SIGNATURE_HEADER`. |

Never log passwords, OTPs, transaction PINs, BVNs, card PANs, CVVs, bearer tokens, or provider webhook payloads.

## Request Payload Examples

All sensitive-looking values below are documentation-only placeholders. Replace them at runtime and never persist or log passwords, OTPs, PINs, BVNs, bearer tokens, or webhook signatures.

### Authentication and Profile

```json
{
  "POST /api/auth/register": { "firstName": "Ada", "lastName": "Okafor", "email": "ada.okafor@example.com", "password": "DOCS_ONLY_PASSWORD", "gender": "female", "phoneNumber": "+2348012345678" },
  "POST /api/auth/verify-otp": { "email": "ada.okafor@example.com", "otp": "000000" },
  "POST /api/auth/login": { "email": "ada.okafor@example.com", "password": "DOCS_ONLY_PASSWORD" },
  "POST /api/auth/resend-otp": { "email": "ada.okafor@example.com" },
  "POST /api/auth/forgot-password": { "email": "ada.okafor@example.com" },
  "POST /api/auth/reset-passwordOtp": { "email": "ada.okafor@example.com", "otp": "000000" },
  "POST /api/auth/reset-password": { "email": "ada.okafor@example.com", "otp": "000000", "newPassword": "DOCS_ONLY_NEW_PASSWORD" },
  "POST /api/auth/create-pin": { "pin": "0000" },
  "PUT /api/profile": { "gender": "female", "phoneNumber": "+2348012345678", "country": "NG", "nationality": "Nigerian", "dateOfBirth": "1995-04-12", "address": "12 Example Road, Lagos" },
  "PUT /api/profile/change-password": { "currentPassword": "DOCS_ONLY_CURRENT_PASSWORD", "newPassword": "DOCS_ONLY_NEW_PASSWORD" }
}
```

### Role Management and KYC

```json
{
  "POST /api/auth/make-admin": { "userId": "11111111-1111-4111-8111-111111111111" },
  "POST /api/auth/remove-admin": { "userId": "11111111-1111-4111-8111-111111111111" },
  "POST /api/kyc/bvn": { "bvn": "00000000000" },
  "POST /api/kyc/documents": { "documentType": "INTERNATIONAL_PASSPORT", "documentNumber": "DOCS-ONLY-PASSPORT", "frontImageUrl": "https://example.com/uploads/passport-front.jpg", "selfieImageUrl": "https://example.com/uploads/selfie.jpg", "issuedCountry": "NG", "expiresAt": "2030-12-31" },
  "POST /api/admin/transactions/{id}/manual-review": { "notes": "Provider status requires manual review." }
}
```

### Wallet, Cards, and Transfers

Send `Idempotency-Key: money_move_docs_01` with withdrawal, transfer, card-funding, and card-withdrawal requests. Generate a new unique value for each real operation.

```json
{
  "POST /api/wallet/withdraw": { "amount": 5000, "currency": "NGN", "bankCode": "000013", "accountNumber": "0000000000", "accountName": "Ada Okafor", "description": "Wallet withdrawal", "transactionPin": "0000" },
  "POST /api/wallet/cards/create": { "walletId": "22222222-2222-4222-8222-222222222222", "currency": "USD" },
  "POST /api/wallet/cards/{id}/fund": { "amount": 25, "currency": "USD", "transactionPin": "0000" },
  "POST /api/wallet/cards/{id}/withdraw": { "amount": 10, "currency": "USD", "transactionPin": "0000" },
  "POST /api/transaction/log": { "senderWalletId": "22222222-2222-4222-8222-222222222222", "recipientWalletId": "33333333-3333-4333-8333-333333333333", "amount": 1000, "currency": "NGN", "description": "Wallet transfer", "transactionPin": "0000" }
}
```

The following commands consume no fields; their documented optional payload is `{}`: `POST /api/kyc/start`, both wallet-create endpoints, and card freeze/unfreeze.

### Maplerad Webhook

This provider-only example requires `x-maplerad-signature: DOCS_ONLY_HMAC_SIGNATURE`. The backend verifies the signature against the exact raw JSON bytes.

```json
{
  "id": "evt_docs_01",
  "event": "collections.virtual_account.deposit",
  "data": {
    "reference": "deposit_docs_01",
    "customer_id": "customer_docs_01",
    "amount": 500000,
    "currency": "NGN",
    "status": "success"
  }
}
```

## Common Response Patterns

Most user-facing errors return one of these shapes:

```json
{ "message": "Authentication required" }
```

```json
{ "ok": false, "message": "Invalid transaction PIN" }
```

Money movement success responses usually include `ok: true`, a `transaction`, and sometimes a `provider` object. Duplicate retries with the same idempotency key return `duplicate: true`.

## Auth Flow

1. Register with `POST /api/auth/register`.
2. User receives an email OTP.
3. Verify with `POST /api/auth/verify-otp`.
4. Store the returned JWT securely.
5. Create transaction PIN with `POST /api/auth/create-pin`.
6. Use `POST /api/auth/login` for later sessions.

### Auth Endpoints

| Method | Path | Auth | Body | Success |
| --- | --- | --- | --- | --- |
| `POST` | `/api/auth/register` | No | `firstName`, `lastName`, `email`, `password`, `gender`, `phoneNumber` | `{ "message": "OTP sent to your email. Please verify to complete registration." }` |
| `POST` | `/api/auth/verify-otp` | No | `email`, `otp` | `{ "token": "<jwt>", "message": "Account verified. Please create your transaction PIN." }` |
| `POST` | `/api/auth/login` | No | `email`, `password` | `{ "token": "<jwt>", "userId": "<uuid>", "message": "Login successful. Welcome back!" }` |
| `POST` | `/api/auth/resend-otp` | No | `email` | Message response |
| `POST` | `/api/auth/create-pin` | Bearer | `pin` as 4 digits | `{ "message": "Transaction PIN set successfully." }` |
| `POST` | `/api/auth/make-admin` | Bearer, requester must be `super_admin` | `userId` | `{ "message": "User role updated to admin." }` |
| `POST` | `/api/auth/remove-admin` | Bearer, requester must be `super_admin` | `userId` | `{ "message": "Admin rights removed successfully." }` |

`phoneNumber` must include a country code, for example `+2348012345678`.

## OTP Flow

Account verification OTPs are generated during registration and expire after 5 minutes. `POST /api/auth/resend-otp` issues a new account verification OTP for unverified accounts.

OTP values must only be entered by the user and sent to the backend. Do not persist them in local storage, analytics, crash reports, or logs.

## Password Reset Flow

| Method | Path | Auth | Body | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/api/auth/forgot-password` | No | `email` | Always returns a generic success message when possible to avoid account enumeration. |
| `POST` | `/api/auth/reset-passwordOtp` | No | `email`, `otp` | Verifies a password reset OTP without changing the password. |
| `POST` | `/api/auth/reset-password` | No | `email`, `otp`, `newPassword` | Resets password and clears the OTP fields. |

Password reset OTPs expire after 10 minutes.

## Transaction PIN Flow

The transaction PIN is required for:

- `POST /api/wallet/withdraw`
- `POST /api/transaction/log`
- `POST /api/wallet/cards/{id}/fund`
- `POST /api/wallet/cards/{id}/withdraw`

Create or update it with `POST /api/auth/create-pin`. PIN must be exactly 4 digits. Treat it like a secret and never log it.

## Profile Flow

| Method | Path | Auth | Body or Query | Success |
| --- | --- | --- | --- | --- |
| `GET` | `/api/profile` | Bearer | None | Returns `firstName`, `lastName`, `email`, `gender`, `phoneNumber`, `nationality`, `dateOfBirth`, `address`. |
| `PUT` | `/api/profile` | Bearer | Any of `gender`, `phoneNumber`, `country`, `nationality`, `dateOfBirth`, `address` | Returns updated profile object. `email`, `firstName`, and `lastName` cannot be changed here. |
| `PUT` | `/api/profile/change-password` | Bearer | `currentPassword`, `newPassword` | `{ "message": "Password updated successfully" }` |

The service rejects updates to `email`, `firstName`, and `lastName`.

## KYC Flow

Papafi currently supports Maplerad BVN verification plus document metadata collection.

1. Call `POST /api/kyc/start` to retrieve provider and supported document types.
2. Collect BVN and call `POST /api/kyc/bvn`.
3. If document collection is required, upload images to the client-approved storage flow and send metadata URLs to `POST /api/kyc/documents`.
4. Poll or refresh with `GET /api/kyc/status`.

| Method | Path | Auth | Body | Success |
| --- | --- | --- | --- | --- |
| `POST` | `/api/kyc/start` | Bearer | None | Returns provider `maplerad` and document types. |
| `POST` | `/api/kyc/bvn` | Bearer | `bvn` as 11 digits | `{ "message": "BVN verification passed.", "status": "PASSED" }` or failed status. |
| `POST` | `/api/kyc/documents` | Bearer | `documentType`, optional `documentNumber`, `frontImageUrl`, `backImageUrl`, `selfieImageUrl`, `issuedCountry`, `expiresAt` | `{ "message": "KYC document metadata submitted.", "verificationId": "<uuid>", "status": "PENDING" }` |
| `GET` | `/api/kyc/status` | Bearer | None | Returns user KYC verification records. |

Supported document types are `NIN`, `DRIVERS_LICENSE`, `INTERNATIONAL_PASSPORT`, and `VOTERS_CARD`. BVN is redacted server-side in stored metadata; clients must still avoid storing it.

## Wallet and Account Flow

Use the authenticated user's `userId` from login or JWT-associated state. Wallet endpoints reject access when the path `userId` does not match the authenticated user.

| Method | Path | Auth | Params | Success |
| --- | --- | --- | --- | --- |
| `POST` | `/api/wallet/create/{userId}` | Bearer | `userId` path | Creates or returns an existing NGN wallet and virtual account. |
| `POST` | `/api/wallet/create-usd/{userId}` | Bearer | `userId` path | Requests USD virtual account creation with Maplerad. |
| `GET` | `/api/wallet/balance/{userId}` | Bearer | `userId` path | Returns all wallets for the user. |

Wallet fields include `id`, `currency`, `accountNumber`, `bankName`, `balance`, `availableBalance`, `pendingBalance`, `ledgerBalance`, `usdAccountId`, and `usdAccountStatus`.

## Deposit and Webhook Explanation

Deposits are provider-driven. Frontend/mobile clients should display the user's virtual account details from wallet creation or balance responses, then refresh wallet balance and transaction history after the user pays into that account.

Maplerad calls:

| Method | Path | Auth | Headers | Purpose |
| --- | --- | --- | --- | --- |
| `POST` | `/api/wallet/webhook` | No user auth | `x-maplerad-signature` | Provider callback for deposits, USD account approval, and other provider events. |

The webhook verifies the provider signature over the raw request body. For deposits, the backend credits the matching wallet through the ledger and returns `{ "ok": true, "duplicate": false }`, `{ "ok": true, "duplicate": true }`, or `{ "ok": true, "ignored": true }`.

Do not call this endpoint from frontend/mobile apps.

## Withdrawal Flow

`POST /api/wallet/withdraw`

Auth: Bearer. Headers: `Idempotency-Key`.

Body:

```json
{
  "amount": 5000,
  "currency": "NGN",
  "bankCode": "000013",
  "accountNumber": "<recipient-account-number>",
  "accountName": "Ada Okafor",
  "description": "Withdrawal",
  "transactionPin": "<4-digit-pin>"
}
```

Success:

```json
{
  "ok": true,
  "transaction": {
    "id": "transaction-uuid",
    "type": "withdrawal",
    "amount": "5000.00",
    "currency": "NGN",
    "status": "PROCESSING"
  },
  "provider": {
    "reference": "provider-reference",
    "status": "processing"
  }
}
```

The backend places a ledger hold before calling Maplerad. If the provider call fails, the hold is reversed and the endpoint returns `502`.

## Internal Transfer Flow

`POST /api/transaction/log`

Auth: Bearer. Headers: `Idempotency-Key`.

Body:

```json
{
  "senderWalletId": "sender-wallet-uuid",
  "recipientWalletId": "recipient-wallet-uuid",
  "amount": 1000,
  "currency": "NGN",
  "description": "Wallet transfer",
  "transactionPin": "<4-digit-pin>"
}
```

Success status is `201` for a new transfer and `200` for a duplicate retry. The response includes `ok`, `transaction`, and `duplicate`.

## Card Flow

| Method | Path | Auth | Headers | Body | Success |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/wallet/cards/create` | Bearer | None | `walletId`, `currency` | Returns safe card metadata only. |
| `POST` | `/api/wallet/cards/{id}/fund` | Bearer | `Idempotency-Key` | `amount`, `currency`, `transactionPin` | Funds card after ledger hold and provider submission. |
| `POST` | `/api/wallet/cards/{id}/withdraw` | Bearer | `Idempotency-Key` | `amount`, `currency`, `transactionPin` | Credits wallet from card withdrawal. |
| `POST` | `/api/wallet/cards/{id}/freeze` | Bearer | None | None | Freezes card and returns card metadata. |
| `POST` | `/api/wallet/cards/{id}/unfreeze` | Bearer | None | None | Unfreezes card and returns card metadata. |

Card responses intentionally expose only safe metadata: `id`, `mapleradCardId`, `cardLast4`, `expirationDate`, `brand`, `currency`, `status`, `isFrozen`, and `createdAt`. PAN and CVV are not returned.

## Transaction History

`GET /api/transaction`

Auth: Bearer.

Optional query params:

| Query | Type | Notes |
| --- | --- | --- |
| `walletId` | UUID | Must belong to authenticated user. |
| `cardId` | UUID | Must belong to authenticated user. Includes provider card transactions when available. |
| `type` | `sent` or `received` | Only applies when `walletId` is provided. |
| `startDate` | date-time string | Filters `createdAt >= startDate`. |
| `endDate` | date-time string | Filters `createdAt <= endDate`. |

Success:

```json
{
  "ok": true,
  "count": 1,
  "transactions": [
    {
      "id": "transaction-uuid",
      "type": "deposit",
      "amount": "10000.00",
      "currency": "NGN",
      "status": "SUCCESS",
      "createdAt": "2026-06-18T10:00:00.000Z"
    }
  ]
}
```

## Admin Endpoints

Admin routes require `Authorization: Bearer <jwt>` and `adminMiddleware`, so the authenticated user must have an admin-capable role. Role grant/removal endpoints under `/api/auth` additionally require `super_admin` in the controller.

| Method | Path | Query or Body | Success |
| --- | --- | --- | --- |
| `GET` | `/api/admin/audit-logs` | `page`, `limit` | Paginated sanitized audit log list. |
| `GET` | `/api/admin/risk-flags` | `page`, `limit` | Paginated open risk flags. |
| `GET` | `/api/admin/reconciliation` | `thresholdMinutes` | Stale provider transactions needing reconciliation. |
| `POST` | `/api/admin/transactions/{id}/manual-review` | Body `notes` optional | Marks transaction reconciliation status as `MANUAL_REVIEW`. |
| `GET` | `/api/admin/users/{userId}/wallet-summary` | `userId` path | Wallet summary for the selected user. |

Pagination defaults: `page=1`, `limit=50`, max `limit=100`.

## Health and Readiness

| Method | Path | Auth | Success |
| --- | --- | --- | --- |
| `GET` | `/` | No | Plain text `Welcome to the API!` |
| `GET` | `/health` | No | `{ "status": "ok" }` |
| `GET` | `/ready` | No | `{ "status": "ready" }`; returns `503` with `{ "status": "not_ready" }` when database readiness fails. |

## Idempotency-Key Usage

Generate one stable idempotency key per user-confirmed money movement operation. Reuse the same key only when retrying the same operation after a timeout or ambiguous network failure.

Recommended client pattern:

1. Generate a key before sending the request.
2. Persist it with the pending operation locally until a final response is received.
3. Retry with the same key for the same operation.
4. Generate a new key when the user starts a new withdrawal, transfer, card fund, or card withdrawal.

Do not reuse one idempotency key across different endpoints, amounts, wallets, cards, or recipients.

## Endpoint Coverage Matrix

| # | Method | Path |
| --- | --- | --- |
| 1 | `GET` | `/` |
| 2 | `GET` | `/health` |
| 3 | `GET` | `/ready` |
| 4 | `POST` | `/api/auth/register` |
| 5 | `POST` | `/api/auth/verify-otp` |
| 6 | `POST` | `/api/auth/login` |
| 7 | `POST` | `/api/auth/resend-otp` |
| 8 | `POST` | `/api/auth/create-pin` |
| 9 | `POST` | `/api/auth/make-admin` |
| 10 | `POST` | `/api/auth/remove-admin` |
| 11 | `POST` | `/api/auth/forgot-password` |
| 12 | `POST` | `/api/auth/reset-password` |
| 13 | `POST` | `/api/auth/reset-passwordOtp` |
| 14 | `GET` | `/api/profile` |
| 15 | `PUT` | `/api/profile` |
| 16 | `PUT` | `/api/profile/change-password` |
| 17 | `POST` | `/api/kyc/start` |
| 18 | `POST` | `/api/kyc/bvn` |
| 19 | `POST` | `/api/kyc/documents` |
| 20 | `GET` | `/api/kyc/status` |
| 21 | `POST` | `/api/wallet/webhook` |
| 22 | `POST` | `/api/wallet/create/{userId}` |
| 23 | `POST` | `/api/wallet/create-usd/{userId}` |
| 24 | `GET` | `/api/wallet/balance/{userId}` |
| 25 | `POST` | `/api/wallet/withdraw` |
| 26 | `POST` | `/api/wallet/cards/create` |
| 27 | `POST` | `/api/wallet/cards/{id}/fund` |
| 28 | `POST` | `/api/wallet/cards/{id}/withdraw` |
| 29 | `POST` | `/api/wallet/cards/{id}/freeze` |
| 30 | `POST` | `/api/wallet/cards/{id}/unfreeze` |
| 31 | `GET` | `/api/transaction` |
| 32 | `POST` | `/api/transaction/log` |
| 33 | `GET` | `/api/admin/audit-logs` |
| 34 | `GET` | `/api/admin/risk-flags` |
| 35 | `GET` | `/api/admin/reconciliation` |
| 36 | `POST` | `/api/admin/transactions/{id}/manual-review` |
| 37 | `GET` | `/api/admin/users/{userId}/wallet-summary` |

## Frontend and Mobile Integration Notes

- Store JWTs in the platform's secure storage mechanism. Avoid local storage for mobile and avoid exposing tokens to analytics tools.
- Treat `401` as a session-expired or invalid-token state and send the user through login again.
- Treat `403` on money movement as either authorization failure or invalid transaction PIN depending on the response message.
- Show pending or processing states after withdrawals and card funding. Provider settlement may complete asynchronously.
- Refresh `/api/wallet/balance/{userId}` and `/api/transaction` after deposit, withdrawal, transfer, or card operations.
- Do not implement direct frontend calls to Maplerad for backend-owned operations.
- Keep BVN, OTP, transaction PIN, password, PAN, and CVV values out of logs, crash reports, screenshots, and support transcripts.
- Use `docs/swagger.json` for generated TypeScript clients or API contract tests.

## Sandbox and Staging Testing Checklist

- Register a new user with a unique email and E.164 phone number.
- Verify account OTP and confirm JWT is returned.
- Create transaction PIN.
- Login and confirm `userId` is available for wallet paths.
- Create NGN wallet and verify virtual account fields are displayed.
- Start KYC, verify BVN with approved sandbox data, and submit document metadata using test image URLs.
- Request wallet balance and confirm KYC/account-tier changes where applicable.
- Test internal transfer with a unique `Idempotency-Key`.
- Retry the same transfer with the same `Idempotency-Key` and confirm `duplicate: true` or duplicate-safe behavior.
- Test withdrawal with invalid PIN and confirm `403`.
- Test withdrawal with a unique idempotency key and confirm transaction response.
- Create, fund, withdraw from, freeze, and unfreeze a virtual card using non-sensitive card metadata only.
- Simulate or wait for Maplerad webhook delivery in staging; do not call provider webhook from the app.
- Verify transaction history filters by wallet, card, date range, and sent/received type.
- For admin builds, verify audit logs, risk flags, reconciliation queue, manual review, and user wallet summary with an admin token.
