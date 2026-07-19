# Maplerad Integration Audit

Audit date: 2026-07-19

Scope: Papafi backend Maplerad service, wallet/KYC/transaction controllers, routes, reconciliation, environment validation, OpenAPI/Swagger docs, and related tests/scripts.

Official documentation reviewed:

- Maplerad Authentication: `https://maplerad.dev/docs/authentication`
- Maplerad Environment: `https://maplerad.dev/docs/environment`
- Maplerad Customers Overview: `https://maplerad.dev/docs/customers`
- Create Customer: `https://maplerad.dev/reference/create-a-customer`
- Enroll Customer Full: `https://maplerad.dev/reference/enroll-customer`
- Upgrade Customer Tier 1: `https://maplerad.dev/reference/upgrade-customer-tier-1`
- Upgrade Customer Tier 2: `https://maplerad.dev/reference/upgrade-customer-tier-2`
- Verify BVN: `https://maplerad.dev/reference/verify-bvn`
- Create Static Account: `https://maplerad.dev/reference/create-a-virtual-account`
- Get Customer Virtual Accounts: `https://maplerad.dev/reference/get-customer-virtual-accounts`
- Create USD Account: `https://maplerad.dev/reference/create-usd-account`
- Transfers Overview: `https://maplerad.dev/docs/transfers`
- Local Payments: `https://maplerad.dev/reference/local-payments`
- Issuing Guide: `https://maplerad.dev/docs/issuing`
- Create Card: `https://maplerad.dev/reference/create-a-card`
- Fund Card: `https://maplerad.dev/reference/fund-a-card`
- Withdraw From Card: `https://maplerad.dev/reference/withdraw-from-a-card`
- Get Card Transactions: `https://maplerad.dev/reference/get-card-transactions`
- Verifying Webhooks: `https://maplerad.dev/docs/verifying-webhooks`

## Compatibility Table

| Papafi operation | Current Papafi endpoint/path | Current Maplerad endpoint/path | Method | Request payload | Authentication header | Expected response fields | Current webhook event | Documentation status | Required fix |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| API base URL | Backend env | `https://api.maplerad.com/v1` | n/a | n/a | n/a | n/a | n/a | Current: sandbox and production use same URL with different keys | Enforce HTTPS and normalize `/v1`; patched |
| Auth | Provider service | All provider paths | n/a | n/a | `Authorization: Bearer SECRET_KEY` | 401 on invalid auth | n/a | Current | Header already Bearer; readiness script added |
| Production whitelist | Deployment/network | All provider paths | n/a | n/a | Bearer secret | 403 likely whitelist/permission | n/a | Current | Readiness script classifies 403; operational whitelist must be confirmed by live check |
| Request timeout | Provider service | All provider paths | n/a | n/a | Bearer secret | Timeout within 15s | n/a | Required for readiness | 15s axios timeout patched |
| Retries | Provider service | All provider paths | n/a | n/a | Bearer secret | Retry only transient errors | n/a | Not endpoint-specific | Patched to retry network/5xx only, not 4xx |
| Request IDs | Provider service | All provider paths | n/a | n/a | Bearer secret + `X-Request-Id` | Provider request id if returned | n/a | Operational requirement | Patched generated `X-Request-Id` |
| Create customer | `POST /api/wallet/create/{userId}`, cards, withdrawal | `/customers` | POST | `first_name`, `last_name`, `email`, `country` | Bearer secret | `data.id` or `id` | n/a | Current | No endpoint fix; duplicate handling remains local persistence by `mapleradCustomerId` |
| Retrieve/list customer | Readiness script | `/customers?page=1&page_size=1` | GET | Query only | Bearer secret | JSON object/list envelope | n/a | Current | Added readiness check |
| Update/upgrade customer tier 1 | Service only | `/customers/upgrade/tier1` | PATCH | `customer_id`, `dob`, `identification_number`, `phone`, `address`, optional `photo` | Bearer secret | Provider tier response | n/a | Current | Endpoint already current; caller flow still incomplete |
| Customer tier 2 | Not implemented | `/customers/upgrade/tier2` | PATCH | `customer_id`, `identity`, `photo` | Bearer secret | Provider tier response | n/a | Current | Not implemented; no speculative patch |
| Full customer enroll | Not implemented | `/customers/enroll` | POST | Full customer/KYC payload | Bearer secret | `id` | n/a | Current | Not implemented; consider only when replacing two-step flow |
| BVN verification | `POST /api/kyc/bvn` | `/identity/bvn` | POST | `bvn` | Bearer secret | Provider identity details/status | n/a | Current | Endpoint current; raw BVN redacted in stored metadata |
| Create NGN virtual account | `POST /api/wallet/create/{userId}` | `/collections/virtual-account` | POST | `customer_id`, `currency`, optional `preferred_bank` | Bearer secret | `account_number`, `bank_name`/`bank.name`, `id` | `collection.successful` for credits | Previous code used obsolete `/issuing/virtual_accounts` | Patched endpoint and response mapping |
| Get customer virtual accounts | Not exposed | `/customers/{customer_id}/virtual-account` | GET | Path `customer_id` | Bearer secret | Account list | n/a | Current | Not implemented; no frontend contract exists |
| Create USD account | `POST /api/wallet/create-usd/{userId}` | `/collections/virtual-account/usd` | POST | `customer_id`, `meta` | Bearer secret | `reference` | USD request events are implementation-specific | Current endpoint | Existing meta likely incomplete for production; no speculative patch |
| Transfer initiation | `POST /api/wallet/withdraw` | `/transfers` | POST | `bank_code`, `account_number`, `amount` in minor units, `currency`, `reason`, optional `reference` | Bearer secret | `id`, `reference`, `status` | `transfer.successful`, `transfer.failed` | Previous code used nested `destination` and major-unit amount | Patched payload and amount scaling |
| Transfer status lookup | Reconciliation worker | `/transactions/{id}` | GET | Path id/reference | Bearer secret | `status` | n/a | Generic transaction endpoint is assumed from implementation; specific transfer status page not confirmed | Leave as reconciliation fallback; live readiness does not claim pass |
| Card creation | `POST /api/wallet/cards/create` | `/issuing` | POST | `customer_id`, `currency=USD`, `type=VIRTUAL`, `auto_approve=true`, optional `brand`, `amount` | Bearer secret | `id`/`reference`, safe card metadata | `issuing.created.successful`, `issuing.created.failed` | Current | Endpoint current; ensure user is tier 1 before production card creation |
| Card funding | `POST /api/wallet/cards/{id}/fund` | `/issuing/{id}/fund` | POST | `amount` in minor units | Bearer secret | `id`/`reference`, `status` | `issuing.transaction` or card funding event | Current | Endpoint current; money movement not live-tested |
| Card withdrawal | `POST /api/wallet/cards/{id}/withdraw` | `/issuing/{id}/withdraw` | POST | `amount` in minor units | Bearer secret | `id`/`reference`, `status` | `issuing.transaction` | Current | Endpoint current; money movement not live-tested |
| Card transactions | `GET /api/transaction?cardId=...` | `/issuing/{id}/transactions` | GET | Path card id | Bearer secret | Transaction array | `issuing.transaction` | Previous code used `/issuing/cards/{id}/transactions` | Patched |
| Freeze/unfreeze | `POST /api/wallet/cards/{id}/freeze`, `/unfreeze` | `/issuing/{id}/freeze`, `/issuing/{id}/unfreeze` | PATCH | Empty body | Bearer secret | Provider result | Possible issuing events | Not confirmed in reviewed docs | Left unchanged; requires official reference confirmation before production use |
| Deposit/credit webhook | `POST /api/wallet/webhook` | Provider callback | POST | Raw JSON body | Svix headers | HTTP 200 on valid known/unknown events | `collection.successful`, `collection.failed` | Previous code primarily expected old deposit event name | Patched `collection.successful`; legacy alias retained |
| Transfer webhook | `POST /api/wallet/webhook` | Provider callback | POST | Raw JSON body | Svix headers | HTTP 200 on valid event | `transfer.successful`, `transfer.failed` | Current docs | Patched settlement/reversal/manual-review logic |
| Card webhooks | `POST /api/wallet/webhook` | Provider callback | POST | Raw JSON body | Svix headers | HTTP 200 on valid event | `issuing.created.successful`, `issuing.created.failed`, `issuing.transaction`, `issuing.terminated`, `issuing.charge`, `issuing.activation` | Current docs | Event acceptance patched; business effects remain conservative |
| Webhook signature | `POST /api/wallet/webhook` | Provider callback | POST | Raw body | `svix-id`, `svix-timestamp`, `svix-signature` | Reject invalid/stale | All | Previous HMAC-SHA512 `x-maplerad-signature` was obsolete | Patched to HMAC-SHA256 Svix scheme with timestamp tolerance |

## Security Notes

- No provider secret, BVN, PAN, CVV, bearer token, webhook secret, or full sensitive provider payload should be printed by readiness or smoke tests.
- The live readiness script does not perform transfers, deposits, card funding, card withdrawals, or unauthorized identity checks.
- The staging smoke test skips live KYC and provider-affecting wallet/account creation unless `MAPLERAD_LIVE_TESTS_ENABLED=true`.
- Real-money movement remains blocked pending explicit authorization and successful controlled production checks.
