# Changelog

## 2026-08-06

- Added durable default NGN wallet provisioning jobs and worker processing after successful BVN/Tier 1 KYC.
- Added wallet provisioning status and admin support endpoints.
- Hardened Maplerad already-enrolled customer recovery with Nigerian phone normalization, documented customer-list wrappers, strict malformed-response errors, sanitized decision logs, and identity-fingerprint cooldowns.
- Updated wallet balance states so active provisioning and reconciliation are no longer reported as `NOT_PROVISIONED`.
- Added additive migration `WalletProvisioningJobs1766592000000`.
