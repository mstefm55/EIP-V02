# V1 to V2 Security Transfer Matrix

Date: 2026-08-01

Scope: first controlled security reference transfer wave from V1 to V2. V1 is evidence only; V2 architecture remains authoritative.

V1 repository identified: `D:/Projects/EIP/eip-core`.

V2 repository: `D:/Projects/EIP/eip-core-v2`.

## Transfer summary

| Control | Intended security behaviour | V1 evidence | V1 DB / migration dependencies | V1 tests found | V2 current evidence | V2 DB / migration dependencies | V2 tests found | V2 equivalent | Retain from V1 | Do not copy from V1 | V2 improvement required | Migration required | Priority | Risk | Wave |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OTP request and verification | OTP is time-bound, hashed, attempt-limited, single-use, and never returned to the browser. Development logging is impossible in production and only allowed for explicit allowlisted non-production runtime modes. | `D:/Projects/EIP/eip-core/services/api/src/routes/auth.js`; `D:/Projects/EIP/eip-core/services/api/src/config.js`; `D:/Projects/EIP/eip-core/services/api/src/auth/crypto.js` | `0022_auth_schema.sql`; `0023_auth_core_tables.sql`; OTP challenge tables in V1 auth migrations | `auth_cookie_policy.test.mjs`; `session_policy.test.mjs`; auth/security tests under `services/api/test` | `services/api/src/routes/auth.js`; `services/api/src/auth/crypto.js`; `services/api/src/auth/otpLogging.js`; `services/api/src/server.js` | `db/migrations/v2_0004_auth_shell_foundation.sql`; `db/migrations/v2_0023_auth_stepup_device_otp.sql` | `services/api/test/otpLoggingPolicy.test.mjs`; existing API test suite | Partial, improved by this wave | Hashing, expiry, attempt counters, single-use challenge, delivery abstraction, production-safe logging guard with missing/unknown modes failing closed | Route-scattered environment reads or debug branches that become production authority | Broader OTP integration tests with DB-backed request/verify flow and abuse/rate-limit coverage | No | High | Medium | 1 and 3 |
| Sessions | HttpOnly session cookie, tenant/realm-bound session row, idle/absolute expiry, revocation, logout, and minimal whoami output. | `src/server.js`; `src/routes/auth.js`; `src/auth/sessionPolicy.js` in V1 | `0022_auth_schema.sql`; `0023_auth_core_tables.sql`; `0032_auth_session_attrs_realm.sql` | `auth_cookie_policy.test.mjs`; `session_policy.test.mjs`; `surface_access.test.mjs` | `services/api/src/plugins/authShell.js`; `services/api/src/routes/auth.js`; `services/api/src/server.js` | `v2_0004_auth_shell_foundation.sql`; `v2_0023_auth_stepup_device_otp.sql` | `authShell.requirePermission.test.mjs`; API tests | Partial | Cookie/session mechanics, revocation model, minimal identity projection, realm separation | V1-specific realm/module assumptions and route-owned business policy | Complete parity tests for rotation, logout revocation, session realm isolation, and sensitive field exclusion | Maybe | High | High | 3 |
| CSRF | Mutating browser requests require a CSRF value tied to the session/cookie model and trusted origin assumptions. | `src/server.js` V1 `requireCsrf`; `src/routes/auth.js`; V1 config `CSRF_PEPPER` | Auth session table stores CSRF hash/material; `0023_auth_core_tables.sql`; `0032_auth_session_attrs_realm.sql` | `auth_cookie_policy.test.mjs`; `session_policy.test.mjs`; gateway/public hardening tests | `services/api/src/plugins/authShell.js`; `services/api/src/server.js`; `apps/workbench-ui/src/services/apiClient.js` | `v2_0004_auth_shell_foundation.sql` | `processAuthzGuards.test.mjs`; `apiEndpointSecurity.test.mjs` | Partial | Double-submit/equivalent validation, origin gate, protected-method discipline | Scattered CSRF handling in individual routes | Centralize tests for every mutating EIP route and ensure metadata endpoint validation runs before CSRF headers are read | No | High | Medium | 3 |
| Device security | Device token is hashed, device state can be trusted/untrusted/revoked, and revoked devices cannot authenticate. | `src/routes/auth.js`; V1 device helpers in auth route; `src/config.js` device settings | `0092_auth_passkeys.sql`; auth device/session migrations | `passkey_config.test.mjs`; `session_policy.test.mjs`; auth flow tests | `services/api/src/routes/auth.js`; `services/api/src/plugins/authShell.js` | `v2_0023_auth_stepup_device_otp.sql` | Existing auth shell tests; no full device regression suite yet | Partial | Trust-state model, revocation checks, device-bound session metadata | V1 UI/module shortcuts for device administration | Add DB-backed tests for trust elevation, revoke, revoked-device login denial, and device cookie policy | No | High | Medium | 3 |
| Step-up authentication | Privileged actions require fresh higher-assurance authentication within a bounded TTL. | `src/auth/privilegedStepUp.js`; `src/auth/sessionPolicy.js`; `src/routes/auth.js` | Auth session attrs and TOTP/passkey/OTP credentials | `session_policy.test.mjs`; `admin_security_ops.test.mjs`; password/step-up tests | `services/api/src/plugins/authShell.js`; route guards call `app.requirePermission(...)`; step-up structures are present but not fully transferred | `v2_0004_auth_shell_foundation.sql`; `v2_0023_auth_stepup_device_otp.sql` | `authShell.requirePermission.test.mjs`; `processAuthzGuards.test.mjs` | Partial | Freshness window, assurance recorded on session, privileged helper contract | Hardcoded module/admin policy embedded in route code | Governed permission + step-up policy metadata and regression tests for expiry/fail-closed behaviour | Maybe | High | High | 3 |
| TOTP | Authenticator-app enrollment uses protected secret storage, `otpauth://` provisioning, confirmation/verification, and reset/recovery controls. | `src/routes/auth.js`; V1 TOTP encryption helpers; `src/config.js` `TOTP_SECRET_KEY` | Auth credential tables; passkey/TOTP migrations including `0092_auth_passkeys.sql` | `passkey_config.test.mjs`; auth/security tests | `services/api/src/routes/auth.js`; `services/api/src/auth/crypto.js` | `v2_0004_auth_shell_foundation.sql` | Existing API test suite does not yet fully prove TOTP lifecycle | Partial | Secret encryption pattern, QR/URI provisioning, verification, no raw secret after setup except intended enrollment moment | V1 route shape if it hides business/security policy outside V2 auth shell | Add confirmation/replay/reset tests and review response fields for setup-only disclosure | No | High | Medium | 3 |
| Bootstrap / onboarding | Bootstrap tokens are hashed, time-bound, one-time, audited, and drive password/TOTP/trusted-device/agreement completion safely. | `src/routes/bootstrap.js`; `src/auth/crypto.js`; V1 config bootstrap peppers | `0037_tenant_onboarding.sql`; `0038_tenant_agreement.sql`; auth core migrations | bootstrap/auth tests and security audit tests under V1 test tree | `services/api/scripts/bootstrap_v2_auth_seed.mjs`; `docs/RAILWAY_V2_DEPLOYMENT.md`; V2 request-access public route | `v2_0001_*`; `v2_0004_*`; seed-owned initial auth state | Staging/deployment validators | Partial | Hashing, expiry, one-time use, audit trail, completion-state gates | Hidden production authority in seeds and V1-specific onboarding assumptions | Formalize bootstrap runtime and remove seed authority from production flow before transfer | Maybe | Medium | High | 4 |
| Realm separation | `/api/public`, `/api/eip`, `/api/portal`, and `/api/edi` have distinct session/API-key expectations and cannot be crossed silently. | `src/server.js`; `src/routes/public_gateway.js`; `src/routes/edi_gateway.js`; `src/routes/authz.js`; `src/routes/gateway.js` | Session attrs realm migration `0032`; API-key integration `0033`; gateway profile migrations | `surface_access.test.mjs`; `gateway_verification.test.mjs`; `public_gateway_runtime.test.mjs`; `public_commerce_hardening.test.mjs` | `services/api/src/server.js`; `services/api/src/plugins/authShell.js`; `apps/workbench-ui/src/services/apiEndpointSecurity.js` | `v2_0004_auth_shell_foundation.sql`; current public UI surface metadata | `authShell.requirePermission.test.mjs`; `apiEndpointSecurity.test.mjs` | Partial | Realm checks, no cross-realm fallback, API-key vs browser-session separation | Hardcoded provider/module allowlists and V1 gateway compatibility assumptions | Continue narrowing endpoint authority by realm and add DTO fences before future portal/EDI transfer | Maybe | High | High | 1, 3, 4 |
| API keys and gateway secrets | API keys are stored hashed/peppered, raw key is shown once, secrets are encrypted or reference-only, gateway ingress is audited. | `src/server.js`; `src/services/gateway/secretStore.js`; `src/services/gateway/audit.js`; gateway routes | `0033_auth_api_key_integration.sql`; `0044_gateway_idempotency.sql`; `0049_tenant_connection_profile.sql`; `0091_connection_secret_vault.sql`; `0096_security_event_ops.sql` | `gateway_api_keys.test.mjs`; `secret_store.test.mjs`; `gateway_outbound_security.test.mjs`; `security_audit.test.mjs` | V2 does not yet have full gateway secret governance transferred | No V2 gateway secret migration in current chain | Security validators only | No / planned | Hash/pepper, encrypt-at-rest, display-once, audit and idempotency semantics | V1 payment/provider compatibility structures or hardcoded module authority | Dedicated V2 gateway secret model with governed metadata and RLS; not part of this wave | Yes | Medium | High | 4 |
| Auditability | Security-relevant events are recorded with tenant/context, without leaking passwords, OTPs, tokens, secrets, or session IDs. | `src/services/gateway/audit.js`; `src/routes/bootstrap.js`; `src/routes/auth.js`; `src/server.js` | `0096_security_event_ops.sql`; gateway audit tables | `admin_security_ops.test.mjs`; `security_audit.test.mjs`; gateway audit tests | `services/api/src/routes/auth.js`; validation scripts; partial logging | No complete V2 security event table yet | `otpLoggingPolicy.test.mjs`; validators | Partial | Event taxonomy, no secret values in logs, audit on failure/success transitions | Overly route-local audit calls that lack governed event shape | Create V2 security audit event model after RLS design and DTO boundaries are tightened | Maybe | Medium | Medium | 4 |

## V1 transfer boundaries

### A. Transfer as behaviour and implementation

These controls are generic security mechanics and should be adapted with minimal semantic change:

- Cryptographic hash/timing helpers: `D:/Projects/EIP/eip-core/services/api/src/auth/crypto.js`.
- Password verification semantics: `D:/Projects/EIP/eip-core/services/api/src/auth/password.js`.
- Session cookie/CSRF mechanics: `D:/Projects/EIP/eip-core/services/api/src/server.js`.
- Step-up freshness evaluation: `D:/Projects/EIP/eip-core/services/api/src/auth/sessionPolicy.js`.
- TOTP verification/enrollment primitives: `D:/Projects/EIP/eip-core/services/api/src/routes/auth.js`.
- OTP hashing, expiry, attempt counters and consumption semantics: `D:/Projects/EIP/eip-core/services/api/src/routes/auth.js`.
- Secret encryption/fingerprint helpers: `D:/Projects/EIP/eip-core/services/api/src/services/gateway/secretStore.js`.
- Security negative test patterns: V1 tests under `D:/Projects/EIP/eip-core/services/api/test`.

### B. Transfer as behaviour but redesign implementation

These behaviours are valuable, but V2 must express their authority through the kernel/process/UI-engine model:

- Permission/realm policy: V1 `src/server.js` and `src/routes/authz.js` prove behaviour, but V2 must keep `app.requirePermission(...)` and governed metadata as authority.
- Route-owned security policy: V1 auth/bootstrap routes prove controls, but V2 should move repeatable policy into auth shell helpers.
- Direct tenant filtering: V1 uses query-level tenant filters; V2 must add fail-closed RLS in a later wave.
- Bootstrap/onboarding: V1 `src/routes/bootstrap.js` proves one-time-token behaviour, but V2 cannot let seed scripts become hidden production authority.
- Gateway/provider security: V1 gateway routes and secret store prove security behaviour, but V2 must avoid provider hardcoding and model connection governance.
- UI permission/visibility logic: V1 dashboard patterns are useful UX references only; V2 UI must remain metadata/render-engine-owned.

### C. Do not transfer

These items would violate V2 intent or weaken the security model:

- V1-specific tenant/module assumptions and deprecated schema names from V1 migrations.
- Compatibility/debug paths that exist only to preserve V1 runtime history.
- Any raw secret display after save; V1 gateway secret tests should be copied as negative behaviour, not any legacy leak path.
- Hardcoded provider/module allowlists or React business authority.
- Duplicate authentication frameworks; V2 keeps one auth shell.
- Seed-owned production authority or hidden bootstrap identity creation.

## Current blocker interaction

- F-001, active governed effects referencing unsupported backing schema, does not directly block OTP endpoint hardening. It can block future security transfer where effect execution becomes a privileged side-effect path, because an unsupported effect may fail open at the workflow edge or create runtime-only authorization ambiguity.
- F-003, raw database rows crossing process API boundaries, does not directly block this wave. It must be fixed before transferring security endpoints that touch sessions, devices, credentials, gateway secrets, or audit records, because DTO work is needed to prove sensitive fields cannot cross API boundaries.

## Drift check

- Kernel-first alignment: this document does not change the kernel or process engine.
- Metadata authority: transfer plan preserves DB/governed metadata as V2 authority.
- UI-engine alignment: F-006 hardens metadata endpoints without embedding business module behaviour.
- Security/tenancy: RLS is documented as a future fail-closed control and not implemented prematurely.
- Schema discipline: no table or migration is introduced by this matrix.
