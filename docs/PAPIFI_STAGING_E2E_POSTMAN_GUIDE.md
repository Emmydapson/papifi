# Papifi Staging E2E Postman Guide

Source of truth: current Express route registration, controllers, middleware, entities, services, and generated Swagger/OpenAPI in this repository.

Set this Postman variable first:

```text
baseUrl = https://api.papifi.com
```

Use bearer tokens as:

```text
Authorization: Bearer {{accessToken}}
```

Never paste provider secrets, JWT secrets, BVNs, OTPs, PINs, passwords, account numbers, webhook signing secrets, or card PAN/CVV into shared logs.

## CURRENT TEST BLOCKERS / RISKS

- OTP delivery is required for fresh registration unless staging is configured with the non-production test OTP bypass. Registration returns only a message, not a token or user ID.
- `ENABLE_TEST_OTP_BYPASS=true` only works when `NODE_ENV !== production`; the bypass is ignored in production by code.
- `GET /ready` returns `503 schema_not_ready` when TypeORM reports pending migrations or required entity columns are missing.
- Production mode requires DB env vars, `JWT_SECRET`, `SESSION_SECRET`, `EMAIL_PROVIDER`, `SMTP_FROM_EMAIL`, `CORS_ALLOWED_ORIGINS`, and provider-specific email credentials.
- Maplerad config must resolve an environment-specific secret key: `MAPLERAD_SANDBOX_SECRET_KEY` for sandbox or `MAPLERAD_PRODUCTION_SECRET_KEY` for production.
- `NODE_ENV=production` refuses `MAPLERAD_ENVIRONMENT=sandbox` unless `MAPLERAD_ALLOW_PRODUCTION_SANDBOX=true`.
- Maplerad webhook signature mode requires an environment-specific `whsec_...` webhook secret. API public/secret keys are not webhook signing secrets.
- `MAPLERAD_WEBHOOK_VERIFICATION_MODE=disabled` is rejected in production.
- Maplerad BVN verification and virtual-account creation call the provider. Complete fresh-user KYC/wallet tests require authorized test BVN/profile data and a working Maplerad environment.
- Default NGN wallet provisioning creates/updates a durable provisioning job and now processes immediately after confirmed Tier 1; if Maplerad returns a retryable/provider error, the job can remain `RETRYING`, `FAILED`, or `RECONCILIATION_REQUIRED`.
- The reconciliation worker is disabled unless `RECONCILIATION_WORKER_ENABLED=true`; stale external transfer reconciliation will not run automatically when disabled.
- Inbound NGN funding is webhook-driven. There is no public manual funding or sandbox deposit simulation endpoint in this backend.
- Money movement requires existing wallet balance. A newly provisioned wallet starts with zero balance unless a provider deposit webhook credits it.
- Admin endpoints require an authenticated user whose stored role is `admin` or `super_admin`. `/api/auth/make-admin` and `/api/auth/remove-admin` require `super_admin`.
- Wallet owned routes contain an admin bypass check, but `authMiddleware` currently attaches only `id` and `email` to `req.user`; it does not attach `role`. Treat wallet owned routes as owner-only at runtime.
- Swagger/OpenAPI is missing current runtime routes for `/api/wallet/provisioning-status` and `/api/wallet/provisioning-status/{userId}`.
- Swagger/OpenAPI is missing current runtime admin routes for `/api/admin/wallet-provisioning`, `/api/admin/wallet-provisioning/{id}`, `/api/admin/wallet-provisioning/{id}/retry`, and `/api/admin/wallet-provisioning/{id}/mark-manual-review`.

## Swagger / Runtime Mismatches

- Runtime implements `GET /api/wallet/provisioning-status/:userId?`; Swagger/OpenAPI currently omits it.
- Runtime implements four admin wallet provisioning routes under `/api/admin/wallet-provisioning`; Swagger/OpenAPI currently omits them.
- Runtime serves `/api-docs`, `/swagger.json`, and `/openapi.yaml` only through `registerApiDocs`; these documentation-serving routes are not listed as API paths in Swagger.
- Running code is authoritative for all payloads below.

## Authentication And Onboarding

```text
FLOW: Register
PURPOSE: Create an unverified user and send an email OTP.
METHOD: POST
URL: {{baseUrl}}/api/auth/register
AUTH: None
HEADERS: Content-Type: application/json
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "firstName": "Papifi",
  "lastName": "Tester",
  "email": "papifi.test.001@example.com",
  "password": "StrongPassword123!",
  "gender": "female",
  "phoneNumber": "+2348012345678"
}
EXPECTED SUCCESS:
HTTP 200
{
  "message": "OTP sent to your email. Please verify to complete registration."
}
IMPORTANT FAILURE CODES: 400 duplicate email/phone; 400/502 email provider errors; 500 save/env errors.
NOTES: All six body fields are required by current implementation/entity constraints. `phoneNumber` must match E.164. Registration does not return `userId`, access token, refresh token, or verification state. Frontend should save nothing sensitive from this response; proceed to OTP verification.
```

```text
FLOW: Verify Registration/Email OTP
PURPOSE: Verify account email and receive the JWT used by authenticated flows.
METHOD: POST
URL: {{baseUrl}}/api/auth/verify-otp
AUTH: None
HEADERS: Content-Type: application/json
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "email": "papifi.test.001@example.com",
  "otp": "123456"
}
EXPECTED SUCCESS:
HTTP 200
{
  "token": "<jwt>",
  "userId": "<uuid>",
  "message": "Account verified. Please create your transaction PIN."
}
IMPORTANT FAILURE CODES: 400 user not found; 400 invalid/expired/wrong-purpose OTP; 500 missing JWT_SECRET or save error.
NOTES: Capture `token` as `{{accessToken}}` and `userId` as `{{userId}}`. There is no refresh token.
```

```text
FLOW: Resend Registration OTP
PURPOSE: Send a new account-verification OTP for an unverified account.
METHOD: POST
URL: {{baseUrl}}/api/auth/resend-otp
AUTH: None
HEADERS: Content-Type: application/json
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "email": "papifi.test.001@example.com"
}
EXPECTED SUCCESS:
HTTP 200
{
  "message": "A new OTP has been sent to your email. Please check and verify."
}
IMPORTANT FAILURE CODES: 400 account already verified; 400/502 email provider errors; 429 rate limit.
NOTES: Unknown emails return the generic OTP response with HTTP 200.
```

```text
FLOW: Login
PURPOSE: Authenticate a verified user.
METHOD: POST
URL: {{baseUrl}}/api/auth/login
AUTH: None
HEADERS: Content-Type: application/json
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "email": "papifi.test.001@example.com",
  "password": "StrongPassword123!"
}
EXPECTED SUCCESS:
HTTP 200
{
  "token": "<jwt>",
  "userId": "<uuid>",
  "message": "Login successful. Welcome back!"
}
IMPORTANT FAILURE CODES: 400 invalid credentials; 400 account not verified; 500 missing JWT_SECRET.
NOTES: Capture `token` as `{{accessToken}}`; capture `userId` as `{{userId}}`. Token expires in 1 hour. No refresh token route exists.
```

```text
FLOW: Forgot Password
PURPOSE: Issue a password-reset OTP.
METHOD: POST
URL: {{baseUrl}}/api/auth/forgot-password
AUTH: None
HEADERS: Content-Type: application/json
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "email": "papifi.test.001@example.com"
}
EXPECTED SUCCESS:
HTTP 200
{
  "message": "If the account can receive this request, an OTP has been sent."
}
IMPORTANT FAILURE CODES: 400/502 email provider errors; 429 rate limit.
NOTES: Unknown emails return the same generic HTTP 200 response.
```

```text
FLOW: Verify Password-Reset OTP
PURPOSE: Confirm a password-reset OTP before resetting password.
METHOD: POST
URL: {{baseUrl}}/api/auth/reset-passwordOtp
AUTH: None
HEADERS: Content-Type: application/json
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "email": "papifi.test.001@example.com",
  "otp": "123456"
}
EXPECTED SUCCESS:
HTTP 200
{
  "message": "OTP verified successfully. You can now reset your password."
}
IMPORTANT FAILURE CODES: 400 account not found; 400 invalid/expired/wrong-purpose OTP; 429 rate limit.
NOTES: This does not clear the OTP. `POST /api/auth/reset-password` still requires the OTP.
```

```text
FLOW: Reset Password
PURPOSE: Set a new password using a valid password-reset OTP.
METHOD: POST
URL: {{baseUrl}}/api/auth/reset-password
AUTH: None
HEADERS: Content-Type: application/json
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "email": "papifi.test.001@example.com",
  "otp": "123456",
  "newPassword": "NewStrongPassword123!"
}
EXPECTED SUCCESS:
HTTP 200
{
  "message": "Password reset successful. You can now log in with your new password."
}
IMPORTANT FAILURE CODES: 400 account not found; 400 missing/invalid reset OTP; 429 rate limit.
NOTES: Successful reset clears OTP fields.
```

Not implemented in current routes: refresh token, logout, current authenticated user/me endpoint.

## Transaction PIN

```text
FLOW: Create/Set Transaction PIN
PURPOSE: Set or replace the authenticated user's transaction PIN.
METHOD: POST
URL: {{baseUrl}}/api/auth/create-pin
AUTH: Bearer token required
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "pin": "1234"
}
EXPECTED SUCCESS:
HTTP 200
{
  "message": "Transaction PIN set successfully."
}
IMPORTANT FAILURE CODES: 401 missing/invalid token; 400 PIN not 4 digits; 404 user not found; 429 rate limit.
NOTES: Requires bearer token only. Does not require current PIN, OTP, or password. This endpoint overwrites any existing PIN.
```

Not implemented in current routes: verify PIN, change PIN with current PIN, reset PIN, forgot PIN flow.

## Profile

```text
FLOW: Get Profile
PURPOSE: Fetch current authenticated user's profile.
METHOD: GET
URL: {{baseUrl}}/api/profile
AUTH: Bearer token required
HEADERS: Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "firstName": "Papifi",
  "lastName": "Tester",
  "email": "papifi.test.001@example.com",
  "gender": "female",
  "phoneNumber": "+2348012345678",
  "nationality": "NG",
  "dateOfBirth": "1995-04-12",
  "address": "12 Example Road",
  "city": "Ikeja",
  "state": "Lagos",
  "postalCode": "100001",
  "country": "NG"
}
IMPORTANT FAILURE CODES: 401 missing/invalid token; 400 user not found.
NOTES: If no profile row exists, the service creates one from immutable User fields.
```

```text
FLOW: Update Profile
PURPOSE: Update optional profile fields used by KYC/Tier 1.
METHOD: PUT
URL: {{baseUrl}}/api/profile
AUTH: Bearer token required
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "phoneNumber": "+2348012345678",
  "country": "NG",
  "nationality": "NG",
  "dateOfBirth": "1995-04-12",
  "address": "12 Example Road",
  "city": "Ikeja",
  "state": "Lagos",
  "postalCode": "100001"
}
EXPECTED SUCCESS:
HTTP 200
{
  "id": "<profileId>",
  "firstName": "Papifi",
  "lastName": "Tester",
  "email": "papifi.test.001@example.com",
  "address": "12 Example Road",
  "city": "Ikeja",
  "state": "Lagos",
  "postalCode": "100001",
  "phoneNumber": "+2348012345678",
  "country": "NG",
  "dateOfBirth": "1995-04-12",
  "gender": "female",
  "nationality": "NG",
  "user": { "...": "user relation may be included by TypeORM" }
}
IMPORTANT FAILURE CODES: 401 missing/invalid token; 500 invalid field or validation error.
NOTES: Allowed fields are `address`, `city`, `state`, `postalCode`, `phoneNumber`, `country`, `dateOfBirth`, `nationality`. `email`, `firstName`, and `lastName` cannot be updated. `country`/`nationality` must be two-letter ISO codes. `dateOfBirth` must be `YYYY-MM-DD`. There is no separate profile photo upload/set route.
```

```text
FLOW: Change Password
PURPOSE: Change authenticated user's password using current password.
METHOD: PUT
URL: {{baseUrl}}/api/profile/change-password
AUTH: Bearer token required
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "currentPassword": "StrongPassword123!",
  "newPassword": "NewStrongPassword123!"
}
EXPECTED SUCCESS:
HTTP 200
{
  "message": "Password updated successfully"
}
IMPORTANT FAILURE CODES: 401 missing/invalid token; 400 invalid current password; 500 service/email notification error.
NOTES: Requires current password. Does not require OTP.
```

Tier 1 field classification:

- Required at registration: `firstName`, `lastName`, `email`, `password`, `gender`, `phoneNumber`.
- Immutable/provider identity source: `firstName`, `lastName`, `email`, `gender`.
- Optional profile fields: `address`, `city`, `state`, `postalCode`, `phoneNumber`, `country`, `dateOfBirth`, `nationality`.
- Required before Maplerad Tier 1 can complete: DOB, Nigerian phone, street/address, city, state, country, postal code, BVN.
- Provider-derived BVN identity fields can fill DOB/phone for Tier 1 when returned by Maplerad; do not rely on that in Postman tests.
- `photo` is accepted on `POST /api/kyc/bvn` and sent to Maplerad Tier 1 if supplied, but it is optional in current backend logic.

Complete Tier 1-ready profile payload:

```json
{
  "phoneNumber": "+2348012345678",
  "country": "NG",
  "nationality": "NG",
  "dateOfBirth": "1995-04-12",
  "address": "12 Example Road",
  "city": "Ikeja",
  "state": "Lagos",
  "postalCode": "100001"
}
```

## BVN / KYC

```text
FLOW: Start KYC
PURPOSE: Return available KYC provider and document types.
METHOD: POST
URL: {{baseUrl}}/api/kyc/start
AUTH: Bearer token required
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY: {}
EXPECTED SUCCESS:
HTTP 200
{
  "message": "KYC can be completed with Maplerad BVN verification and document metadata submission.",
  "provider": "maplerad",
  "documentTypes": ["NIN", "DRIVERS_LICENSE", "INTERNATIONAL_PASSPORT", "VOTERS_CARD"]
}
IMPORTANT FAILURE CODES: 401 missing/invalid token.
NOTES: Request body is not used.
```

```text
FLOW: Verify BVN And Attempt Maplerad Tier 1
PURPOSE: Verify BVN, enroll/confirm Maplerad Tier 1, and immediately attempt default NGN wallet provisioning when Tier 1 is confirmed.
METHOD: POST
URL: {{baseUrl}}/api/kyc/bvn
AUTH: Bearer token required
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "bvn": "00000000000",
  "dateOfBirth": "1995-04-12",
  "phoneNumber": "+2348012345678",
  "address": {
    "street": "12 Example Road",
    "street2": null,
    "city": "Ikeja",
    "state": "Lagos",
    "country": "NG",
    "postal_code": "100001"
  },
  "city": "Ikeja",
  "state": "Lagos",
  "country": "NG",
  "postalCode": "100001",
  "photo": "https://example.com/uploads/selfie.jpg"
}
EXPECTED SUCCESS:
HTTP 200
{
  "message": "BVN verified successfully.",
  "code": "BVN_VERIFIED",
  "status": "PASSED",
  "accountTier": "APPROVED",
  "tier1Enrollment": {
    "state": "TIER_1",
    "mapleradCustomerTier": "TIER_1"
  },
  "walletProvisioning": {
    "currency": "NGN",
    "state": "PROVISIONED"
  }
}
IMPORTANT FAILURE CODES: 400 invalid BVN format; 400/422 provider validation; 429 provider/rate limit; 502 provider auth/schema/unavailable; 503 provider insufficient balance.
NOTES: BVN is sent directly as top-level `bvn`, not nested. User ID is taken from JWT only. `bvn` must be an 11-digit string. Tier 1 fields are taken from request body first, then profile/provider identity fallback. Current possible KYC status values are `PENDING`, `PASSED`, `FAILED`. Current Tier 1 states are `NOT_STARTED`, `PROFILE_INCOMPLETE`, `PENDING`, `PROCESSING`, `TIER_1`, `RETRYING`, `RECONCILIATION_REQUIRED`, `FAILED`.
```

BVN verified + Tier 1 confirmed response shape:

```json
{
  "message": "BVN verified successfully.",
  "code": "BVN_VERIFIED",
  "status": "PASSED",
  "accountTier": "APPROVED",
  "tier1Enrollment": {
    "state": "TIER_1",
    "mapleradCustomerTier": "TIER_1"
  },
  "walletProvisioning": {
    "currency": "NGN",
    "state": "PROVISIONED"
  }
}
```

BVN verified + Tier 1 profile incomplete response shape:

```json
{
  "message": "BVN verified successfully, but additional profile information is required to complete Tier 1 KYC.",
  "code": "BVN_VERIFIED",
  "status": "PASSED",
  "accountTier": "BVN_VERIFIED",
  "tier1Enrollment": {
    "state": "PROFILE_INCOMPLETE",
    "code": "MAPLERAD_TIER1_PROFILE_INCOMPLETE",
    "missingFields": ["city", "state", "postalCode"]
  },
  "walletProvisioning": {
    "currency": "NGN",
    "state": "KYC_REQUIRED"
  }
}
```

```text
FLOW: Submit KYC Document Metadata
PURPOSE: Store document metadata for compliance records; automated document verification is not implemented.
METHOD: POST
URL: {{baseUrl}}/api/kyc/documents
AUTH: Bearer token required
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "documentType": "INTERNATIONAL_PASSPORT",
  "documentNumber": "DOCS-ONLY-PASSPORT",
  "frontImageUrl": "https://example.com/uploads/passport-front.jpg",
  "backImageUrl": "https://example.com/uploads/passport-back.jpg",
  "selfieImageUrl": "https://example.com/uploads/selfie.jpg",
  "issuedCountry": "NG",
  "expiresAt": "2030-12-31"
}
EXPECTED SUCCESS:
HTTP 201
{
  "message": "KYC document metadata submitted.",
  "verificationId": "<uuid>",
  "status": "PENDING"
}
IMPORTANT FAILURE CODES: 401 missing/invalid token; 400 unsupported document type.
NOTES: Supported document types: `NIN`, `DRIVERS_LICENSE`, `INTERNATIONAL_PASSPORT`, `VOTERS_CARD`. This sets local `accountTier` to `DOCUMENT_SUBMITTED`.
```

```text
FLOW: Get KYC Status
PURPOSE: Return sanitized current KYC summaries by type.
METHOD: GET
URL: {{baseUrl}}/api/kyc/status
AUTH: Bearer token required
HEADERS: Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "userId": "<uuid>",
  "verifications": [
    {
      "id": "<uuid>",
      "type": "BVN",
      "status": "PASSED",
      "provider": "maplerad",
      "providerEnvironment": "sandbox",
      "providerRequestId": "req_...",
      "bvn": { "last4": "0000" },
      "createdAt": "2026-08-28T10:00:00.000Z",
      "verifiedAt": "2026-08-28T10:00:00.000Z",
      "attemptCount": 1
    }
  ]
}
IMPORTANT FAILURE CODES: 401 missing/invalid token.
NOTES: No separate KYC history endpoint exists. This endpoint returns one current summary per KYC type and redacts raw provider/document metadata.
```

## Automatic NGN Wallet Provisioning

Current automatic flow:

- Controller: `KYCController.verifyBvn`.
- Service calls: `MapleRadService.enrollMapleradCustomerTier1(...)`, then `walletProvisioningService.provisionDefaultNgnWallet(userId, { processNow: true, actorUserId: userId })` when `tier1Result.tier1 === true`.
- `provisionDefaultNgnWallet` always creates or reuses a `wallet_provisioning_job` through `ensureJob`.
- Immediate expected state after successful BVN + confirmed Tier 1 is usually `walletProvisioning.state = PROVISIONED` if Maplerad account creation/recovery succeeds. Retryable or reconciliation errors can return `RETRYING`, `FAILED`, or `RECONCILIATION_REQUIRED`.

```text
FLOW: Get Authenticated User NGN Provisioning Status
PURPOSE: Check default NGN wallet provisioning state for the JWT user.
METHOD: GET
URL: {{baseUrl}}/api/wallet/provisioning-status
AUTH: Bearer token required
HEADERS: Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "currency": "NGN",
  "state": "PROVISIONED",
  "message": "Your NGN wallet is ready.",
  "retryable": false,
  "updatedAt": "2026-08-28T10:00:00.000Z"
}
IMPORTANT FAILURE CODES: 401 missing token; 500 server error.
NOTES: Runtime route exists but Swagger/OpenAPI currently omits it. States include `NOT_STARTED`, `PENDING`, `PROCESSING`, `PROVISIONED`, `RETRYING`, `RECONCILIATION_REQUIRED`, `FAILED`.
```

```text
FLOW: Get Specific User NGN Provisioning Status
PURPOSE: Check default NGN wallet provisioning state for a specific user.
METHOD: GET
URL: {{baseUrl}}/api/wallet/provisioning-status/{{userId}}
AUTH: Bearer token required; owner only at runtime
HEADERS: Authorization: Bearer {{accessToken}}
PATH PARAMS: userId
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "currency": "NGN",
  "state": "PROVISIONED",
  "message": "Your NGN wallet is ready.",
  "retryable": false,
  "updatedAt": "2026-08-28T10:00:00.000Z"
}
IMPORTANT FAILURE CODES: 401 missing/invalid token; 403 wrong userId; 500 server error.
NOTES: Runtime route exists but Swagger/OpenAPI currently omits it.
```

```text
FLOW: Get Wallet Balance/List
PURPOSE: List all local wallets for a user and expose aggregate wallet state.
METHOD: GET
URL: {{baseUrl}}/api/wallet/balance/{{userId}}
AUTH: Bearer token required; owner only at runtime
HEADERS: Authorization: Bearer {{accessToken}}
PATH PARAMS: userId
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "walletState": "PROVISIONED",
  "wallets": [
    {
      "id": "<walletId>",
      "currency": "NGN",
      "availableBalance": 0,
      "pendingBalance": 0,
      "ledgerBalance": 0,
      "accountNumber": "******0000",
      "bankName": "Test Bank",
      "status": "active",
      "providerEnvironment": "sandbox"
    }
  ]
}
IMPORTANT FAILURE CODES: 401 missing/invalid token; 403 wrong userId; 500 server error.
NOTES: Exact runtime path is `GET /api/wallet/balance/:userId`. Implemented `walletState` values: `PROVISIONED`, `PENDING_PROVISIONING`, `KYC_REQUIRED`, `RECONCILIATION_REQUIRED`, `NOT_PROVISIONED`. Provisioning-status endpoint can also return job states `NOT_STARTED`, `PENDING`, `PROCESSING`, `PROVISIONED`, `RETRYING`, `RECONCILIATION_REQUIRED`, `FAILED`.
```

```text
FLOW: Manual NGN Wallet Create/Retry
PURPOSE: Idempotently create/repair a default NGN wallet for an eligible user.
METHOD: POST
URL: {{baseUrl}}/api/wallet/create/{{userId}}
AUTH: Bearer token required; owner only at runtime
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}
PATH PARAMS: userId
QUERY PARAMS: None
BODY: {}
EXPECTED SUCCESS:
HTTP 201 or HTTP 200
{
  "ok": true,
  "wallet": {
    "id": "<walletId>",
    "currency": "NGN",
    "availableBalance": 0,
    "pendingBalance": 0,
    "ledgerBalance": 0,
    "accountNumber": "******0000",
    "bankName": "Test Bank",
    "status": "active",
    "providerEnvironment": "sandbox"
  }
}
IMPORTANT FAILURE CODES: 202 accepted but not provisioned; 400 reconciliation/Tier/provider validation; 401; 403; 502 provider error.
NOTES: Body is ignored. Eligibility requires verified email, transaction PIN, KYC verified, and Maplerad Tier 1 customer reference. A non-terminal provisioning result returns `{ ok: true, wallet: null, walletProvisioning: {...} }`.
```

No wallet detail endpoint, wallet-by-currency endpoint, or unmasked virtual-account details endpoint is currently exposed over HTTP.

## USD Wallet

```text
FLOW: Create USD Wallet / Request USD Virtual Account
PURPOSE: Create or reuse a USD wallet/account for a user.
METHOD: POST
URL: {{baseUrl}}/api/wallet/create-usd/{{userId}}
AUTH: Bearer token required; owner only at runtime
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}
PATH PARAMS: userId
QUERY PARAMS: None
BODY: {}
EXPECTED SUCCESS:
HTTP 201
{
  "ok": true,
  "wallet": {
    "id": "<walletId>",
    "currency": "USD",
    "availableBalance": 0,
    "pendingBalance": 0,
    "ledgerBalance": 0,
    "accountNumber": "******0000",
    "bankName": "USD Bank",
    "status": "pending",
    "providerEnvironment": "sandbox"
  }
}
IMPORTANT FAILURE CODES: 400 provider/user error; 401; 403; 502 provider error.
NOTES: Body is ignored. User ID is required in path. Currency is not sent by client. NGN and USD reuse one Maplerad customer reference; account/provider-reference rows remain separate per currency. Entity enum also includes `GBP`, but there is no HTTP route that provisions GBP.
```

## Wallet / Account Details

Implemented wallet/account routes:

- Wallet list/balance/account summary: `GET /api/wallet/balance/:userId`
- Default NGN provisioning status: `GET /api/wallet/provisioning-status` and `GET /api/wallet/provisioning-status/:userId`
- Manual NGN create/repair: `POST /api/wallet/create/:userId`
- USD create/request: `POST /api/wallet/create-usd/:userId`
- Transaction history: `GET /api/transaction`

Not implemented over HTTP: wallet detail by ID, wallet by currency, unmasked account number details, beneficiary lookup, bank list, account-name resolution, quote/fee endpoint.

## Transfers / Withdrawals / Cards

All routes in this section require `Authorization: Bearer {{accessToken}}`. Money movement routes also require `Idempotency-Key` of at least 8 characters, or `idempotencyKey` in JSON body.

```text
FLOW: Internal Wallet Transfer
PURPOSE: Transfer funds between Papifi wallets.
METHOD: POST
URL: {{baseUrl}}/api/transaction/log
AUTH: Bearer token required
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}; Idempotency-Key: transfer-test-001
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "senderWalletId": "{{walletId}}",
  "recipientWalletId": "{{recipientWalletId}}",
  "amount": 1000,
  "currency": "NGN",
  "description": "Postman internal transfer",
  "transactionPin": "1234"
}
EXPECTED SUCCESS:
HTTP 201
{
  "ok": true,
  "transaction": {
    "id": "<transactionId>",
    "amount": "1000.00",
    "currency": "NGN",
    "type": "transfer",
    "status": "SUCCESS",
    "idempotencyKey": "transfer-test-001",
    "description": "Postman internal transfer",
    "createdAt": "2026-08-28T10:00:00.000Z"
  },
  "duplicate": false
}
IMPORTANT FAILURE CODES: 400 missing params/idempotency/limits/KYC/insufficient balance; 401; 403 invalid PIN or wrong sender wallet; 500.
NOTES: `senderWalletId` must belong to JWT user. Recipient wallet must exist and match currency. Duplicate idempotency returns HTTP 200 with `duplicate: true`.
```

```text
FLOW: Bank Withdrawal / External Transfer
PURPOSE: Debit wallet and submit Maplerad transfer to a bank account.
METHOD: POST
URL: {{baseUrl}}/api/wallet/withdraw
AUTH: Bearer token required
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}; Idempotency-Key: withdraw-test-001
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "amount": 5000,
  "currency": "NGN",
  "bankCode": "000013",
  "accountNumber": "0000000000",
  "accountName": "Papifi Test Receiver",
  "description": "Postman withdrawal test",
  "transactionPin": "1234"
}
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "transaction": {
    "id": "<transactionId>",
    "amount": "5000.00",
    "currency": "NGN",
    "type": "withdrawal",
    "status": "PROCESSING",
    "provider": "maplerad",
    "providerReference": "<providerReference>",
    "description": "Postman withdrawal test",
    "createdAt": "2026-08-28T10:00:00.000Z"
  },
  "provider": {
    "reference": "<providerReference>",
    "status": "<providerStatus>"
  }
}
IMPORTANT FAILURE CODES: 400 missing params/idempotency/limits/KYC/insufficient balance; 401; 403 invalid PIN; 404 wallet not found; 502 provider call failed and hold reversed; 500.
NOTES: Provider is Maplerad. The service sends amount in minor units to Maplerad. `accountName` is accepted but not sent to Maplerad in current service code.
```

```text
FLOW: Create Virtual Card
PURPOSE: Create a Maplerad virtual card linked to an existing wallet.
METHOD: POST
URL: {{baseUrl}}/api/wallet/cards/create
AUTH: Bearer token required
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "walletId": "{{walletId}}",
  "currency": "USD"
}
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "card": {
    "id": "<cardId>",
    "mapleradCardId": "<providerCardId>",
    "cardLast4": "4242",
    "expirationDate": "12/30",
    "brand": "VISA",
    "currency": "USD",
    "status": "active",
    "isFrozen": false,
    "createdAt": "2026-08-28T10:00:00.000Z"
  }
}
IMPORTANT FAILURE CODES: 400 missing walletId/currency; 401; 404 wallet not found; 500 provider/server error.
NOTES: No initial amount field is exposed by controller. PAN/CVV are not returned.
```

```text
FLOW: Fund Virtual Card
PURPOSE: Move funds from wallet to a virtual card through Maplerad.
METHOD: POST
URL: {{baseUrl}}/api/wallet/cards/{{cardId}}/fund
AUTH: Bearer token required
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}; Idempotency-Key: card-fund-test-001
PATH PARAMS: id = cardId
QUERY PARAMS: None
BODY:
{
  "amount": 25,
  "currency": "USD",
  "transactionPin": "1234"
}
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "transaction": {
    "id": "<transactionId>",
    "amount": "25.00",
    "currency": "USD",
    "type": "transfer",
    "status": "PROCESSING",
    "provider": "maplerad",
    "description": "Virtual card funding"
  },
  "provider": {
    "reference": "<providerReference>",
    "status": "<providerStatus>"
  }
}
IMPORTANT FAILURE CODES: 400 missing params/idempotency/limits/KYC/insufficient balance; 401; 403 invalid PIN; 404 card not found; 502 provider call failed; 500.
NOTES: Duplicate idempotency returns HTTP 200 with `duplicate: true`.
```

```text
FLOW: Withdraw From Virtual Card
PURPOSE: Withdraw funds from a virtual card back into its wallet.
METHOD: POST
URL: {{baseUrl}}/api/wallet/cards/{{cardId}}/withdraw
AUTH: Bearer token required
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}; Idempotency-Key: card-withdraw-test-001
PATH PARAMS: id = cardId
QUERY PARAMS: None
BODY:
{
  "amount": 10,
  "currency": "USD",
  "transactionPin": "1234"
}
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "transaction": {
    "id": "<transactionId>",
    "amount": "10.00",
    "currency": "USD",
    "type": "deposit",
    "status": "SUCCESS",
    "provider": "maplerad",
    "description": "Virtual card withdrawal"
  },
  "provider": {
    "reference": "<providerReference>",
    "status": "<providerStatus>"
  }
}
IMPORTANT FAILURE CODES: 400 missing params/idempotency; 401; 403 invalid PIN; 404 card not found; 500 provider/server error.
NOTES: Controller checks `Idempotency-Key`, but the provider call uses Maplerad directly and ledger credit idempotency is based on provider reference.
```

```text
FLOW: Freeze Virtual Card
PURPOSE: Freeze a virtual card at Maplerad and mark local card frozen.
METHOD: POST
URL: {{baseUrl}}/api/wallet/cards/{{cardId}}/freeze
AUTH: Bearer token required
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}
PATH PARAMS: id = cardId
QUERY PARAMS: None
BODY: {}
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "message": "Card frozen successfully",
  "card": {
    "id": "<cardId>",
    "mapleradCardId": "<providerCardId>",
    "status": "active",
    "isFrozen": true
  }
}
IMPORTANT FAILURE CODES: 401; 404 card not found; 500 provider/server error.
NOTES: Body is ignored.
```

```text
FLOW: Unfreeze Virtual Card
PURPOSE: Unfreeze a virtual card at Maplerad and mark local card unfrozen.
METHOD: POST
URL: {{baseUrl}}/api/wallet/cards/{{cardId}}/unfreeze
AUTH: Bearer token required
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}
PATH PARAMS: id = cardId
QUERY PARAMS: None
BODY: {}
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "message": "Card unfrozen successfully",
  "card": {
    "id": "<cardId>",
    "mapleradCardId": "<providerCardId>",
    "status": "active",
    "isFrozen": false
  }
}
IMPORTANT FAILURE CODES: 401; 404 card not found; 500 provider/server error.
NOTES: Body is ignored.
```

Not implemented over HTTP: beneficiary lookup, bank list, account-name resolution, transfer quote/fee, separate initiate/confirm transfer, transaction status detail endpoint.

## Funding / Inbound Transfers

```text
FLOW: Maplerad Webhook
PURPOSE: Process provider deposit, transfer, USD account, card, and other events.
METHOD: POST
URL: {{baseUrl}}/api/wallet/webhook
AUTH: None; provider signature required by webhook middleware logic
HEADERS: Content-Type: application/json; svix-id: msg_test_001; svix-timestamp: <unixSeconds>; svix-signature: v1,<signature>
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "id": "evt_test_001",
  "event": "collection.successful",
  "data": {
    "reference": "provider_reference_001",
    "customer_id": "cus_provider_001",
    "amount": 500000,
    "currency": "NGN",
    "status": "success"
  }
}
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "duplicate": false
}
IMPORTANT FAILURE CODES: 400 raw body/signature headers missing; 401 invalid signature/source IP; 202 ignored in ip_and_requery mode when verification cannot confirm; 500 processing error.
NOTES: Deposit amount from Maplerad is divided by 100 before ledger credit. Real Postman deposit testing requires a valid Maplerad/Svix signature from the configured endpoint secret or an approved provider-delivered webhook. There is no public manual funding endpoint. A signed arbitrary mock event can test signature/idempotency but cannot safely simulate a real deposit unless it matches provider re-query/signature behavior.
```

How to test NGN inbound funding in staging without real money:

- Use Maplerad sandbox/provider tooling if it supports a sandbox collection deposit to the generated NGN virtual account.
- Confirm the provider sends a signed `collection.successful` or `collections.virtual_account.deposit` webhook to `/api/wallet/webhook`.
- Then call `GET /api/wallet/balance/{{userId}}` and `GET /api/transaction`.
- If Maplerad sandbox cannot simulate deposits, the current backend has no implemented HTTP fallback for fake funding.

## Transactions

```text
FLOW: List Transaction History
PURPOSE: Return wallet transactions plus optional card transactions for the authenticated user.
METHOD: GET
URL: {{baseUrl}}/api/transaction
AUTH: Bearer token required
HEADERS: Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: walletId, cardId, type, startDate, endDate
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "count": 1,
  "transactions": [
    {
      "id": "<transactionId>",
      "amount": "1000.00",
      "currency": "NGN",
      "type": "transfer",
      "status": "SUCCESS",
      "createdAt": "2026-08-28T10:00:00.000Z"
    }
  ]
}
IMPORTANT FAILURE CODES: 401; 403 wallet/card not owned by user; 500.
NOTES: Example with filters: `{{baseUrl}}/api/transaction?walletId={{walletId}}&type=sent&startDate=2026-08-01&endDate=2026-08-31`. `type` filter supports `sent` or `received`. No pagination is implemented. Transaction types are `deposit`, `withdrawal`, `transfer`. Status values in entity include `pending`, `success`, `failed`, `PENDING`, `PROCESSING`, `SUCCESS`, `FAILED`, `REVERSED`.
```

No transaction detail route is implemented.

## Beneficiaries

No beneficiary routes are implemented. There is no create/list/delete beneficiary endpoint and no exposed bank-account verification endpoint.

## Admin / Wallet Provisioning / Reconciliation

Admin routes below require:

```text
Authorization: Bearer {{adminAccessToken}}
```

The authenticated user must have stored role `admin` or `super_admin`, except `/api/auth/make-admin` and `/api/auth/remove-admin`, which require `super_admin`.

```text
FLOW: Grant Admin Role
PURPOSE: Make another user an admin.
METHOD: POST
URL: {{baseUrl}}/api/auth/make-admin
AUTH: Bearer token required; super_admin only
HEADERS: Content-Type: application/json; Authorization: Bearer {{superAdminAccessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "userId": "{{targetUserId}}"
}
EXPECTED SUCCESS:
HTTP 200
{
  "message": "User role updated to admin."
}
IMPORTANT FAILURE CODES: 401; 403 requester not super_admin; 404 target user not found.
NOTES: This is under auth routes, not `/api/admin`.
```

```text
FLOW: Remove Admin Role
PURPOSE: Revert an admin user to normal user.
METHOD: POST
URL: {{baseUrl}}/api/auth/remove-admin
AUTH: Bearer token required; super_admin only
HEADERS: Content-Type: application/json; Authorization: Bearer {{superAdminAccessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "userId": "{{targetUserId}}"
}
EXPECTED SUCCESS:
HTTP 200
{
  "message": "Admin rights removed successfully."
}
IMPORTANT FAILURE CODES: 401; 403 requester not super_admin; 404 target user not found.
NOTES: This is under auth routes, not `/api/admin`.
```

```text
FLOW: List Audit Logs
PURPOSE: Paginated audit-log review with sanitized metadata.
METHOD: GET
URL: {{baseUrl}}/api/admin/audit-logs?page=1&limit=50
AUTH: Bearer token required; admin/super_admin
HEADERS: Authorization: Bearer {{adminAccessToken}}
PATH PARAMS: None
QUERY PARAMS: page, limit
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "page": 1,
  "limit": 50,
  "total": 1,
  "items": [{ "id": "<auditLogId>", "action": "LOGIN", "metadata": {} }]
}
IMPORTANT FAILURE CODES: 401; 403.
NOTES: `limit` is capped at 100.
```

```text
FLOW: List Open Risk Flags
PURPOSE: Paginated review of open risk flags.
METHOD: GET
URL: {{baseUrl}}/api/admin/risk-flags?page=1&limit=50
AUTH: Bearer token required; admin/super_admin
HEADERS: Authorization: Bearer {{adminAccessToken}}
PATH PARAMS: None
QUERY PARAMS: page, limit
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "page": 1,
  "limit": 50,
  "total": 1,
  "items": [{ "id": "<riskFlagId>", "status": "OPEN", "metadata": {} }]
}
IMPORTANT FAILURE CODES: 401; 403.
NOTES: Only `OPEN` flags are returned.
```

```text
FLOW: List Reconciliation Queue
PURPOSE: List stale Maplerad provider transactions needing reconciliation.
METHOD: GET
URL: {{baseUrl}}/api/admin/reconciliation?thresholdMinutes=30
AUTH: Bearer token required; admin/super_admin
HEADERS: Authorization: Bearer {{adminAccessToken}}
PATH PARAMS: None
QUERY PARAMS: thresholdMinutes
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "count": 1,
  "transactions": [
    {
      "id": "<transactionId>",
      "type": "withdrawal",
      "status": "PROCESSING",
      "provider": "maplerad",
      "providerReference": "provider_ref_001",
      "reconciliationStatus": "PENDING"
    }
  ]
}
IMPORTANT FAILURE CODES: 401; 403.
NOTES: Finds stale `PROCESSING`/`PENDING` provider transactions through `reconciliationService`.
```

```text
FLOW: Mark Transaction Manual Review
PURPOSE: Mark a transaction reconciliation status as manual review.
METHOD: POST
URL: {{baseUrl}}/api/admin/transactions/{{transactionId}}/manual-review
AUTH: Bearer token required; admin/super_admin
HEADERS: Content-Type: application/json; Authorization: Bearer {{adminAccessToken}}
PATH PARAMS: id = transactionId
QUERY PARAMS: None
BODY:
{
  "notes": "Provider status requires manual review."
}
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "transaction": {
    "id": "<transactionId>",
    "reconciliationStatus": "MANUAL_REVIEW",
    "reconciliationNotes": "Provider status requires manual review."
  }
}
IMPORTANT FAILURE CODES: 401; 403; 404 transaction not found.
NOTES: If `notes` is omitted, code uses `Marked by admin`.
```

```text
FLOW: Get User Wallet Summary
PURPOSE: Admin summary of a user's local wallets.
METHOD: GET
URL: {{baseUrl}}/api/admin/users/{{userId}}/wallet-summary
AUTH: Bearer token required; admin/super_admin
HEADERS: Authorization: Bearer {{adminAccessToken}}
PATH PARAMS: userId
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "userId": "<uuid>",
  "wallets": [
    {
      "id": "<walletId>",
      "currency": "NGN",
      "availableBalance": "0.00",
      "pendingBalance": "0.00",
      "ledgerBalance": "0.00",
      "accountNumber": "0000000000",
      "bankName": "Test Bank"
    }
  ]
}
IMPORTANT FAILURE CODES: 401; 403.
NOTES: Unlike public wallet responses, this route returns stored accountNumber unmasked.
```

```text
FLOW: List Wallet Provisioning Jobs
PURPOSE: Admin list of wallet provisioning jobs.
METHOD: GET
URL: {{baseUrl}}/api/admin/wallet-provisioning?page=1&limit=50
AUTH: Bearer token required; admin/super_admin
HEADERS: Authorization: Bearer {{adminAccessToken}}
PATH PARAMS: None
QUERY PARAMS: page, limit
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "page": 1,
  "limit": 50,
  "total": 1,
  "items": [
    {
      "id": "<jobId>",
      "userId": "<uuid>",
      "provider": "maplerad",
      "providerEnvironment": "sandbox",
      "currency": "NGN",
      "state": "PROVISIONED",
      "safeReasonCode": null,
      "retryCount": 0,
      "lastProviderRequestId": null,
      "nextAttemptAt": null,
      "createdAt": "2026-08-28T10:00:00.000Z",
      "updatedAt": "2026-08-28T10:00:00.000Z"
    }
  ]
}
IMPORTANT FAILURE CODES: 401; 403.
NOTES: Runtime route exists but Swagger/OpenAPI currently omits it.
```

```text
FLOW: Get Wallet Provisioning Job
PURPOSE: Fetch one provisioning job by ID.
METHOD: GET
URL: {{baseUrl}}/api/admin/wallet-provisioning/{{jobId}}
AUTH: Bearer token required; admin/super_admin
HEADERS: Authorization: Bearer {{adminAccessToken}}
PATH PARAMS: id = jobId
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "job": {
    "id": "<jobId>",
    "userId": "<uuid>",
    "state": "FAILED",
    "safeReasonCode": "MAPLERAD_TIER1_REQUIRED"
  }
}
IMPORTANT FAILURE CODES: 401; 403; 404 job not found.
NOTES: Runtime route exists but Swagger/OpenAPI currently omits it.
```

```text
FLOW: Retry Wallet Provisioning Job
PURPOSE: Reset a job to pending and immediately retry NGN provisioning.
METHOD: POST
URL: {{baseUrl}}/api/admin/wallet-provisioning/{{jobId}}/retry
AUTH: Bearer token required; admin/super_admin
HEADERS: Content-Type: application/json; Authorization: Bearer {{adminAccessToken}}
PATH PARAMS: id = jobId
QUERY PARAMS: None
BODY: {}
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "job": {
    "id": "<jobId>",
    "userId": "<uuid>",
    "currency": "NGN",
    "state": "PROVISIONED"
  }
}
IMPORTANT FAILURE CODES: 401; 403; 404 job not found.
NOTES: Body is ignored. Runtime route exists but Swagger/OpenAPI currently omits it.
```

```text
FLOW: Mark Wallet Provisioning Manual Review
PURPOSE: Put a wallet provisioning job into reconciliation/manual review.
METHOD: POST
URL: {{baseUrl}}/api/admin/wallet-provisioning/{{jobId}}/mark-manual-review
AUTH: Bearer token required; admin/super_admin
HEADERS: Content-Type: application/json; Authorization: Bearer {{adminAccessToken}}
PATH PARAMS: id = jobId
QUERY PARAMS: None
BODY: {}
EXPECTED SUCCESS:
HTTP 200
{
  "ok": true,
  "job": {
    "id": "<jobId>",
    "state": "RECONCILIATION_REQUIRED",
    "safeReasonCode": "ADMIN_MANUAL_REVIEW"
  }
}
IMPORTANT FAILURE CODES: 401; 403; 404 job not found.
NOTES: Body is ignored. Runtime route exists but Swagger/OpenAPI currently omits it.
```

No Maplerad customer/wallet reconciliation is exposed over HTTP beyond the admin queue and wallet provisioning job actions above.

CLI reconciliation commands:

```text
npm run maplerad:reconcile-customer -- --user-id <papifi-user-id>
npm run maplerad:reconcile-customer -- --email user@example.com
npm run maplerad:reconcile-customer -- --user-id <papifi-user-id> --maplerad-customer-id <customer-id> --confirm
npm run maplerad:reconcile-customer -- --email user@example.com --maplerad-customer-id <customer-id> --confirm
```

Supported args: `--user-id`, `--email`, `--maplerad-customer-id`, `--confirm`. Dry-run by default unless `--confirm` is supplied.

```text
npm run maplerad:reconcile-wallets -- --user-id <papifi-user-id> --environment <sandbox|production>
npm run maplerad:reconcile-wallets -- --user-id <papifi-user-id> --environment <sandbox|production> --confirm
```

Supported args: `--user-id`, `--environment`, `--confirm`. Dry-run by default unless `--confirm` is supplied. Refuses when requested environment does not match resolved Maplerad environment.

## Health And Infrastructure

```text
FLOW: Root
PURPOSE: Basic root response.
METHOD: GET
URL: {{baseUrl}}/
AUTH: None
HEADERS: None
PATH PARAMS: None
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 200
Welcome to the API!
IMPORTANT FAILURE CODES: 500 if process is unhealthy.
NOTES: Plain text response.
```

```text
FLOW: Health
PURPOSE: Liveness check.
METHOD: GET
URL: {{baseUrl}}/health
AUTH: None
HEADERS: None
PATH PARAMS: None
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "status": "ok"
}
IMPORTANT FAILURE CODES: 500 if process is unhealthy.
NOTES: Does not check database/migrations.
```

```text
FLOW: Readiness
PURPOSE: Database and migration/schema readiness check.
METHOD: GET
URL: {{baseUrl}}/ready
AUTH: None
HEADERS: None
PATH PARAMS: None
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 200
{
  "status": "ready"
}
IMPORTANT FAILURE CODES: 503 `not_ready`; 503 `schema_not_ready`.
NOTES: Checks AppDataSource, `SELECT 1`, TypeORM pending migrations, and required entity columns.
```

```text
FLOW: Swagger UI
PURPOSE: Serve interactive API docs when enabled.
METHOD: GET
URL: {{baseUrl}}/api-docs
AUTH: None
HEADERS: None
PATH PARAMS: None
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 200 HTML Swagger UI
IMPORTANT FAILURE CODES: 404 when API docs are disabled.
NOTES: Enabled when `API_DOCS_ENABLED=true`, or in non-production unless `API_DOCS_ENABLED=false`.
```

```text
FLOW: Swagger JSON
PURPOSE: Serve generated OpenAPI JSON when docs are enabled.
METHOD: GET
URL: {{baseUrl}}/swagger.json
AUTH: None
HEADERS: None
PATH PARAMS: None
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 200 JSON OpenAPI document
IMPORTANT FAILURE CODES: 404 when API docs are disabled.
NOTES: Served from `docs/swagger.json`.
```

```text
FLOW: OpenAPI YAML
PURPOSE: Serve generated OpenAPI YAML when docs are enabled.
METHOD: GET
URL: {{baseUrl}}/openapi.yaml
AUTH: None
HEADERS: None
PATH PARAMS: None
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 200 YAML OpenAPI document
IMPORTANT FAILURE CODES: 404 when API docs are disabled.
NOTES: Served from `docs/openapi.yaml`.
```

No provider-health route is implemented.

## Authorization / Security Tests

```text
FLOW: Missing Bearer Token
PURPOSE: Confirm authenticated route rejects absent token.
METHOD: GET
URL: {{baseUrl}}/api/profile
AUTH: None
HEADERS: None
PATH PARAMS: None
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 401
{
  "message": "Authentication required"
}
IMPORTANT FAILURE CODES: N/A
NOTES: Same auth middleware behavior applies to profile, KYC, wallet, transaction, and admin routes.
```

```text
FLOW: Invalid Bearer Token
PURPOSE: Confirm authenticated route rejects invalid JWT.
METHOD: GET
URL: {{baseUrl}}/api/profile
AUTH: Invalid bearer token
HEADERS: Authorization: Bearer invalid.token.value
PATH PARAMS: None
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 401
{
  "message": "Invalid token"
}
IMPORTANT FAILURE CODES: N/A
NOTES: Expired JWT returns `{ "message": "Token has expired. Please log in again." }`.
```

```text
FLOW: Wrong User Wallet Access
PURPOSE: Confirm normal users cannot access another user's wallet route.
METHOD: GET
URL: {{baseUrl}}/api/wallet/balance/{{otherUserId}}
AUTH: Bearer token for {{userId}}
HEADERS: Authorization: Bearer {{accessToken}}
PATH PARAMS: userId = another user's ID
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 403
{
  "ok": false,
  "message": "Forbidden"
}
IMPORTANT FAILURE CODES: 401 if token missing/invalid.
NOTES: Same ownership helper protects `POST /api/wallet/create/:userId`, `POST /api/wallet/create-usd/:userId`, and `GET /api/wallet/provisioning-status/:userId`.
```

```text
FLOW: Wrong User Transaction Wallet Filter
PURPOSE: Confirm transaction history rejects walletId not owned by JWT user.
METHOD: GET
URL: {{baseUrl}}/api/transaction?walletId={{otherWalletId}}
AUTH: Bearer token for {{userId}}
HEADERS: Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: walletId
BODY: None
EXPECTED SUCCESS:
HTTP 403
{
  "ok": false,
  "message": "Forbidden"
}
IMPORTANT FAILURE CODES: 401.
NOTES: `cardId` not owned by user also returns 403.
```

```text
FLOW: Non-Admin Accessing Admin Route
PURPOSE: Confirm admin middleware rejects normal users.
METHOD: GET
URL: {{baseUrl}}/api/admin/audit-logs
AUTH: Bearer token for normal user
HEADERS: Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY: None
EXPECTED SUCCESS:
HTTP 403
{
  "message": "Admin access required"
}
IMPORTANT FAILURE CODES: 401 if token missing/invalid.
NOTES: Applies to all `/api/admin/*` routes.
```

```text
FLOW: Non-Super-Admin Role Change
PURPOSE: Confirm role-management routes reject non-super-admin users.
METHOD: POST
URL: {{baseUrl}}/api/auth/make-admin
AUTH: Bearer token for normal/admin user
HEADERS: Content-Type: application/json; Authorization: Bearer {{accessToken}}
PATH PARAMS: None
QUERY PARAMS: None
BODY:
{
  "userId": "{{targetUserId}}"
}
EXPECTED SUCCESS:
HTTP 403
{
  "message": "Unauthorized. Only super admin can make changes."
}
IMPORTANT FAILURE CODES: 401; 404 target user not found can occur before requester role check.
NOTES: Same behavior for `/api/auth/remove-admin`.
```

## Recommended Complete E2E Sequence

Use:

```text
baseUrl = https://api.papifi.com
```

01 Register

- METHOD: POST
- URL: `{{baseUrl}}/api/auth/register`
- AUTH: None
- JSON:

```json
{
  "firstName": "Papifi",
  "lastName": "Tester",
  "email": "papifi.test.001@example.com",
  "password": "StrongPassword123!",
  "gender": "female",
  "phoneNumber": "+2348012345678"
}
```

- Capture: nothing.

02 Verify OTP

- METHOD: POST
- URL: `{{baseUrl}}/api/auth/verify-otp`
- AUTH: None
- JSON:

```json
{
  "email": "papifi.test.001@example.com",
  "otp": "123456"
}
```

- Capture: `token -> {{accessToken}}`, `userId -> {{userId}}`.

03 Login

- METHOD: POST
- URL: `{{baseUrl}}/api/auth/login`
- AUTH: None
- JSON:

```json
{
  "email": "papifi.test.001@example.com",
  "password": "StrongPassword123!"
}
```

- Capture: `token -> {{accessToken}}`, `userId -> {{userId}}`.

04 Get Profile

- METHOD: GET
- URL: `{{baseUrl}}/api/profile`
- AUTH: Bearer `{{accessToken}}`
- JSON: none
- Capture: inspect current profile.

05 Update Complete Tier 1 Profile

- METHOD: PUT
- URL: `{{baseUrl}}/api/profile`
- AUTH: Bearer `{{accessToken}}`
- JSON:

```json
{
  "phoneNumber": "+2348012345678",
  "country": "NG",
  "nationality": "NG",
  "dateOfBirth": "1995-04-12",
  "address": "12 Example Road",
  "city": "Ikeja",
  "state": "Lagos",
  "postalCode": "100001"
}
```

- Capture: none.

06 Set Transaction PIN

- METHOD: POST
- URL: `{{baseUrl}}/api/auth/create-pin`
- AUTH: Bearer `{{accessToken}}`
- JSON:

```json
{
  "pin": "1234"
}
```

- Capture: none.

07 Submit BVN

- METHOD: POST
- URL: `{{baseUrl}}/api/kyc/bvn`
- AUTH: Bearer `{{accessToken}}`
- JSON:

```json
{
  "bvn": "00000000000",
  "dateOfBirth": "1995-04-12",
  "phoneNumber": "+2348012345678",
  "address": {
    "street": "12 Example Road",
    "city": "Ikeja",
    "state": "Lagos",
    "country": "NG",
    "postal_code": "100001"
  },
  "photo": "https://example.com/uploads/selfie.jpg"
}
```

- Capture: `tier1Enrollment.state`, `walletProvisioning.state`. Continue only if Tier 1 is `TIER_1`; if `PROFILE_INCOMPLETE`, add missing fields and retry.

08 Confirm KYC Status

- METHOD: GET
- URL: `{{baseUrl}}/api/kyc/status`
- AUTH: Bearer `{{accessToken}}`
- JSON: none
- Capture: latest BVN verification ID if needed.

09 Check Wallet Provisioning

- METHOD: GET
- URL: `{{baseUrl}}/api/wallet/provisioning-status`
- AUTH: Bearer `{{accessToken}}`
- JSON: none
- Capture: `state`; if admin review is needed, capture job ID from admin route.

10 Fetch Wallet Balance / Wallet List

- METHOD: GET
- URL: `{{baseUrl}}/api/wallet/balance/{{userId}}`
- AUTH: Bearer `{{accessToken}}`
- JSON: none
- Capture: NGN `wallet.id -> {{walletId}}`, masked `accountNumber`, `bankName`.

11 Retry Balance To Verify Idempotency

- METHOD: GET
- URL: `{{baseUrl}}/api/wallet/balance/{{userId}}`
- AUTH: Bearer `{{accessToken}}`
- JSON: none
- Capture: confirm same `walletState` and wallet ID.

12 Manual NGN Wallet Retry If Needed

- METHOD: POST
- URL: `{{baseUrl}}/api/wallet/create/{{userId}}`
- AUTH: Bearer `{{accessToken}}`
- JSON:

```json
{}
```

- Capture: `wallet.id -> {{walletId}}` or `walletProvisioning.state`.

13 Create USD Wallet

- METHOD: POST
- URL: `{{baseUrl}}/api/wallet/create-usd/{{userId}}`
- AUTH: Bearer `{{accessToken}}`
- JSON:

```json
{}
```

- Capture: USD `wallet.id -> {{usdWalletId}}`, USD status.

14 Fetch Wallet List Again

- METHOD: GET
- URL: `{{baseUrl}}/api/wallet/balance/{{userId}}`
- AUTH: Bearer `{{accessToken}}`
- JSON: none
- Capture: all wallet IDs.

15 Submit Document Metadata

- METHOD: POST
- URL: `{{baseUrl}}/api/kyc/documents`
- AUTH: Bearer `{{accessToken}}`
- JSON:

```json
{
  "documentType": "INTERNATIONAL_PASSPORT",
  "documentNumber": "DOCS-ONLY-PASSPORT",
  "frontImageUrl": "https://example.com/uploads/passport-front.jpg",
  "backImageUrl": "https://example.com/uploads/passport-back.jpg",
  "selfieImageUrl": "https://example.com/uploads/selfie.jpg",
  "issuedCountry": "NG",
  "expiresAt": "2030-12-31"
}
```

- Capture: `verificationId`.

16 List Transactions

- METHOD: GET
- URL: `{{baseUrl}}/api/transaction`
- AUTH: Bearer `{{accessToken}}`
- JSON: none
- Capture: `transaction.id` if any.

17 Test Withdrawal Guard Without Moving Money

- METHOD: POST
- URL: `{{baseUrl}}/api/wallet/withdraw`
- AUTH: Bearer `{{accessToken}}`
- Headers: intentionally omit `Idempotency-Key`
- JSON:

```json
{
  "amount": 1,
  "currency": "NGN",
  "bankCode": "000013",
  "accountNumber": "0000000000",
  "accountName": "Papifi Test Receiver",
  "description": "Guard test",
  "transactionPin": "1234"
}
```

- Capture: expect HTTP 400 missing Idempotency-Key before provider submission.

18 Test Admin Rejection With Normal User

- METHOD: GET
- URL: `{{baseUrl}}/api/admin/audit-logs`
- AUTH: Bearer `{{accessToken}}`
- JSON: none
- Capture: expect HTTP 403.

19 Admin List Wallet Provisioning Jobs

- METHOD: GET
- URL: `{{baseUrl}}/api/admin/wallet-provisioning?page=1&limit=50`
- AUTH: Bearer `{{adminAccessToken}}`
- JSON: none
- Capture: `items[0].id -> {{jobId}}` for retry/manual-review tests.

20 Admin Review Reconciliation Queue

- METHOD: GET
- URL: `{{baseUrl}}/api/admin/reconciliation?thresholdMinutes=30`
- AUTH: Bearer `{{adminAccessToken}}`
- JSON: none
- Capture: stale `transaction.id` if any.

## Audit Summary

- User-facing routes audited: 34.
- Admin routes audited: 11, including two super-admin role-management routes under `/api/auth`.
- Swagger/runtime mismatches: 6 missing runtime routes in Swagger/OpenAPI: two wallet provisioning status variants and four admin wallet provisioning routes.
- Broken/incomplete flows discovered: no refresh/logout/me routes; no PIN verify/change/reset/forgot flow; no profile photo route; wallet owned-route admin bypass is ineffective because `authMiddleware` does not attach role; no wallet detail/by-currency/unmasked account route; no beneficiary/bank-list/account-name/quote routes; no transaction detail/pagination route; no public funding simulation route; inbound funding depends on signed Maplerad webhook/provider sandbox support.
- Recommended first fresh-user test sequence: Register -> Verify OTP -> Login -> Get Profile -> Update complete Tier 1 profile -> Set Transaction PIN -> Submit BVN -> Check KYC status -> Check wallet provisioning -> Fetch wallet balance -> Create USD wallet -> Fetch wallet list -> List transactions -> security/admin rejection tests.
- Required staging environment checks before testing: `/ready` is `ready`; migrations are applied; JWT/session/email/CORS env vars are present; email provider sender is verified; Maplerad environment and secret are valid; webhook signing secret is configured for provider webhook tests; authorized test BVN/profile data is available; reconciliation worker setting is intentional.
