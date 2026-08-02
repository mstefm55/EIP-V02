# V2 Security Transfer Plan

Date: 2026-08-01

Purpose: divide the V1-to-V2 security transfer into controlled, auditable waves. V1 is the behavioural reference; V2 remains kernel-first, process-driven, metadata-governed, and tenant-safe.

## Current stop/go position

Broad security transfer is not approved yet. Broad UI transfer is not approved yet.

Approved now:

- Wave 1 endpoint hardening for metadata-fed API paths.
- Wave 1 production-safe OTP logging guard.
- Documentation for RLS and future transfer boundaries.

Deferred:

- Database RLS migrations.
- Gateway secret/API-key model transfer.
- Bootstrap/onboarding redesign.
- Broad sessions/CSRF/device/TOTP parity.
- Process DTO remediation for F-003.
- Unsupported effect remediation for F-001.

## Wave 1: metadata endpoint security and OTP production logging guard

Controls:

- F-006: governed workbench contract endpoints are path-only and restricted to normalized `/api/eip/...` paths.
- Shared API client rejects absolute URLs, protocol-relative URLs, backslash tricks, encoded scheme/host attempts, non-normalized paths, and unapproved internal destinations before reading CSRF cookies or calling `fetch`.
- F-007: `NODE_ENV`/runtime mode is centralized in runtime config; production aliases never log OTP values even when `LOG_DEV_OTP=true`, and missing/unknown runtime modes fail closed.

Dependencies:

- `apps/workbench-ui/src/services/apiClient.js`
- `apps/workbench-ui/src/engine/contracts.js`
- `services/api/src/server.js`
- `services/api/src/routes/auth.js`

Affected files:

- `apps/workbench-ui/src/services/apiEndpointSecurity.js`
- `apps/workbench-ui/tests/apiEndpointSecurity.test.mjs`
- `services/api/src/auth/otpLogging.js`
- `services/api/test/otpLoggingPolicy.test.mjs`

Migration expectation: none.

Rollback strategy:

- Revert the helper/client/contract/auth logging changes.
- No DB rollback is required.

Validation:

- Workbench unit tests.
- Workbench build.
- API tests.
- Security/process/tenant/staging validators.
- `git diff --check`.

Risks:

- Internal public API paths must continue working for login/request-access/surface bootstrap, while governed workbench contracts must remain EIP-only.
- Overly broad endpoint validation could break legitimate UI contract query strings. Tests preserve ordinary query string support.

Stop/go:

- Go only if validation proves no external fetch occurs after rejection and OTP logging is disabled for production aliases, missing modes, and unknown modes regardless of `LOG_DEV_OTP`.
- Stop if existing internal `/api/public/...` bootstrap flows are broken.

## Wave 2: tenant-context transaction model and RLS architecture

Controls:

- Request-scoped transaction helper that sets `SET LOCAL app.current_tenant_id = '<tenant uuid>'` before tenant-bound SQL.
- Tenant-owned table inventory.
- Fail-closed RLS policies for tenant-owned tables.
- Negative tests proving missing tenant context returns zero rows or fails.

Dependencies:

- `db/migrations/v2_0001_kernel_bootstrap.sql`
- `db/migrations/v2_0002_security_memberships.sql`
- `db/migrations/v2_0003_tenant_settings_rls.sql`
- `db/migrations/v2_0004_auth_shell_foundation.sql`
- `db/migrations/v2_0005_process_schema_foundation.sql`
- `db/migrations/v2_0007_auth_identity_agent_link.sql`
- `db/migrations/v2_0009_ui_surface_engine_foundation.sql`
- `db/migrations/v2_0023_auth_stepup_device_otp.sql`
- API DB plugin and route/service query helpers.

Affected files:

- Future migration file under `db/migrations`.
- API DB transaction helper under `services/api/src/plugins` or a shared DB utility.
- Tests under `services/api/test`.
- RLS documentation/register update.

Migration expectation: yes, dedicated additive migration only.

Rollback strategy:

- Prefer restore-and-replay to the pre-RLS point.
- If additive policies are the only change, a rollback migration may disable policies only with explicit approval and backup plan.

Validation:

- Fresh migration replay.
- RLS negative tests.
- Tenant-scope validator.
- API tests with explicit tenant context.

Risks:

- Enabling RLS before every tenant-bound query has a transaction context can break runtime.
- `eip_core.dropdown_value` lacks direct `tenant_id`; policy design must either join through `dropdown_list` or add a justified denormalized tenant column in a later migration.
- Seed/bootstrap/system operations require explicit privileged context and cannot rely on accidental owner-role bypass.

Stop/go:

- Stop if route/service inventory shows tenant-bound SQL that cannot be wrapped safely.
- Go only after every tenant-owned table has a policy design and test case.

## Wave 3: sessions, CSRF, device trust, step-up, and TOTP

Controls:

- HttpOnly session cookie contract.
- Session expiry, idle touch, revocation, logout, whoami minimal projection.
- CSRF protected-method validation and origin gate.
- Device trust/untrusted/revoked state.
- Step-up freshness and privileged action enforcement.
- TOTP enrollment, provisioning URI, verification, secret protection, and reset/recovery semantics.

Dependencies:

- Wave 2 tenant transaction/RLS model.
- `services/api/src/plugins/authShell.js`
- `services/api/src/routes/auth.js`
- V1 evidence from `D:/Projects/EIP/eip-core/services/api/src/auth/sessionPolicy.js`, `privilegedStepUp.js`, `routes/auth.js`, and V1 tests.

Affected files:

- API auth shell helpers.
- Auth route tests and DB-backed auth flow tests.
- Possibly workbench auth UI only where it consumes existing route contracts.

Migration expectation: maybe. Use existing `eip_auth` tables first. Add migrations only if a proven missing field blocks parity.

Rollback strategy:

- Revert code-level helpers/tests for non-migration changes.
- For any migration, use restore-and-replay. Avoid destructive rollback.

Validation:

- Password login.
- OTP request/verify.
- TOTP bootstrap/verify.
- Device revoke/trust tests.
- Session/CSRF negative tests.
- No secrets/tokens/OTP in responses/logs.

Risks:

- F-003 DTO weakness must be fixed before exposing device/session/credential management endpoints.
- Step-up policy must not become hardcoded module authority in routes.

Stop/go:

- Stop if a future endpoint returns raw session/device/credential rows.
- Go only if DTO and permission gates are explicit and tests prove sensitive field exclusion.

## Wave 4: bootstrap/onboarding, API keys, gateway secret governance, and security audit events

Controls:

- Bootstrap token hashing, expiry, one-time use, completion state, audit.
- API key display-once, hash/pepper storage, revocation/expiry/scopes.
- Gateway outbound secret encryption or secret-reference model.
- Webhook/API-key inbound verification.
- Security audit event model for auth failures, OTP, session revoke, device trust/revoke, step-up, bootstrap, API-key, gateway secret rotation.

Dependencies:

- Wave 2 RLS.
- Wave 3 auth shell parity.
- Gateway/connection-profile V2 model, if introduced.
- V1 reference files: `secretStore.js`, `gateway/audit.js`, `bootstrap.js`, `server.js`.

Affected files:

- API security/gateway services.
- New or existing governed metadata tables only with register justification.
- Tests for secret redaction and display-once.
- Documentation for production bootstrap.

Migration expectation: yes/maybe. Any new table must pass `docs/db/NEW_TABLE_JUSTIFICATION_REGISTER.md`.

Rollback strategy:

- Restore-and-replay for schema.
- Revert route/service transfer if no schema change.

Validation:

- API key raw value shown once only.
- Stored API key hash cannot reveal raw key.
- Provider/webhook secrets never returned publicly or to tenant dashboard.
- Logs redact secret/token/password/apiKey/signature fields.
- Gateway ingress/outbound audit events recorded without secret values.

Risks:

- Seed-owned production authority could become invisible super-admin bootstrap authority.
- Gateway provider-specific assumptions from V1 can drift into hardcoded V2 business logic.

Stop/go:

- Stop if secrets need plaintext storage in JSONB.
- Go only with encryption/reference model, display-safe DTOs, and redaction tests.

## Wave 5: regression audit, penetration-oriented negative tests, and production readiness review

Controls:

- Full cross-control regression suite.
- Negative tests for auth bypass, CSRF bypass, endpoint metadata SSRF-like tricks, RLS missing context, tenant crossover, raw row leakage, secrets in responses/logs.
- Production readiness review and no-merge gates.

Dependencies:

- Waves 1-4 complete.
- F-001 and F-003 remediated or explicitly isolated.

Affected files:

- Validator scripts.
- CI/no-merge gates.
- Test suites.
- Security checklist and developer manual.

Migration expectation: no unless a gap is discovered and approved separately.

Rollback strategy:

- Revert gates/tests only if they are false positives with documented alternative control.

Validation:

- All API tests.
- Workbench tests/build.
- Governance validators.
- Manual production-safety checklist.

Risks:

- A passing suite can still miss process-engine side effects if F-001 remains unresolved.
- UI metadata safety depends on continued avoidance of arbitrary executable code and raw DB row exposure.

Stop/go:

- Stop if any high-risk control still relies on route-local or React-local authority.
- Go only when no high/critical secrets, tenant isolation, auth, or endpoint-boundary gaps remain.

## Immediate next wave recommendation

After Wave 1 lands, run a dedicated Wave 2 for RLS/tenant-context transaction design implementation. Do not start broad session/device/bootstrap transfer until tenant context and DTO boundaries are stable.

## Drift check

- Kernel-first: transfer plan preserves service object/process engine authority.
- Process model: no effect catalog or process model change is introduced here.
- UI engine: endpoint validation strengthens metadata execution safety without turning UI code into business authority.
- Security/tenancy: future RLS and DTO work is explicitly sequenced before broad transfer.
- Schema discipline: migrations are deferred to dedicated waves.
