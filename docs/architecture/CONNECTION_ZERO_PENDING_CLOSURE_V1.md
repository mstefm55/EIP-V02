# EIP Core V2 Connections — Zero-Pending Closure

Status: final Connections control-plane/runtime/operator closure before external provider onboarding.

Date: 2026-09-11

Read with:

- `docs/codex/ARCHITECTURE_GUARDRAILS.md`
- `SECURITY_TARGET.md`
- `docs/architecture/CONNECTION_MANAGEMENT_UI_V2.md`
- `docs/architecture/CONNECTION_EXECUTION_CAPABILITY_V1.md`
- `docs/architecture/CONNECTION_OPERATOR_UI_READINESS_V1.md`

## Closure objective

Connections must not carry an internal engineering/UI/security gap into real provider onboarding. Provider credentials, provider account values and provider-owned endpoint identifiers are onboarding inputs, not unfinished EIP implementation.

The closure keeps the canonical architecture unchanged:

```text
metadata-driven Owner Admin UI
  -> governed Connection contracts
  -> tenant-code target resolved server-side
  -> tenant-scoped profile / encrypted secret boundary
  -> inbound or outbound runtime
  -> Process/Service Object authority when mapped
```

No second integration engine, provider-specific React branch, raw browser `tenant_id`, authz bypass or new persistence table is introduced.

## Gaps closed in the final pass

### Readiness truth

The readiness projection now exposes one canonical `ready` boolean alongside the detailed `configured`, `activation_ready` and `runtime_available` fields. Production acceptance and operator UI therefore consume the same runtime truth instead of depending on a missing compatibility property.

Activation readiness now also reports the governed seven-step profile requirements that persistence already enforces: routing channel, mapping mode, schema version, envelope profile and audit log level. A profile cannot appear green in Test & Health and then fail activation on hidden profile-completeness rules.

### Safe endpoint health checks

Endpoint health checks are non-mutating diagnostics. Their configured method is restricted to `HEAD` or `GET`.

Mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) remain available only through the separate governed authenticated request execution path, which requires `OWNER_ADMIN_CONNECTION_TEST`, CSRF and the normal outbound runtime policy.

Existing non-deprecated profiles with an older mutating probe method are normalized to `HEAD` by the forward migration.

### Operator metadata overwrite seam

The obsolete whole-root `attrs` editor (`provider_extensions`) is removed from the Connections surface. Explicit bounded fields under `attrs.outbound_request`, `attrs.oauth_client_credentials` and `attrs.provider_signature` remain the operator path. This prevents a generic JSON edit from accidentally replacing runtime configuration written by another setup step.

### Dead legacy knobs

The final operator surface no longer exposes:

- `raw_body_required`: the canonical public gateway always preserves raw request bytes for signature verification and idempotency;
- `auth_public_key_ref`: no canonical V2 outbound runtime consumes it;
- the already-retired inbound `oauth2_jwt` configuration.

The existing Connection-profile persistence scrub is extended so these retired values cannot be reintroduced by an older client.

## Security invariants retained

- Profile reads use `OWNER_ADMIN_CONNECTION_READ`.
- Profile writes use `OWNER_ADMIN_CONNECTION_WRITE` plus CSRF.
- Secret generation/rotation/revocation use `OWNER_ADMIN_CONNECTION_SECRET_MANAGE`, CSRF and fresh OTP/TOTP assurance.
- Connection tests use `OWNER_ADMIN_CONNECTION_TEST` plus CSRF.
- Secrets remain encrypted in `tenant.connection_secret` and are never projected back after the one-time generated-value response.
- Owner Admin tenant targeting uses a tenant-code path alias resolved by the server; raw browser-controlled `tenant_id` remains forbidden.
- FORCE RLS remains authoritative on tenant persistence.
- Connection creation remains disabled-draft first; activation remains server-gated.

## Production acceptance gate

The repository contains `services/api/scripts/accept_connections_production.mjs`, an explicit opt-in acceptance harness. It validates the live production database/runtime boundary through the actual Fastify server and tenant transactions, including:

- Owner Admin permission authority;
- canonical Connections UI surface and tenant catalogue;
- disabled draft creation and generated code;
- early activation failure;
- one-time API-key generation and rotation;
- plaintext non-reexposure;
- readiness and activation;
- endpoint projection;
- inbound verification;
- rotated-key rejection;
- duplicate suppression and idempotency conflict;
- cluster-safe rate limiting (`429`);
- mapped Service Object / Process dispatch;
- rejection of external process authority;
- cross-tenant read/write/test/public-route isolation;
- safe disable/revoke/deprecate lifecycle;
- retained audit evidence and credential revocation on deprecation.

The harness is inert unless `CONNECTION_ACCEPTANCE_APPLY=true`, refuses non-seed mutation unless explicitly overridden, and cleans up temporary runtime artifacts.

## Definition of done

The Connections implementation is internally closed when all of the following are true on the production-connected branch:

1. API regression suite passes.
2. Workbench UI regression suite passes.
3. Workbench production build passes.
4. Owner Admin, security, tenant-scope and process-governance gates pass.
5. Forward migration `v2_0062_connection_zero_pending_closure.sql` applies successfully.
6. API and frontend Railway deployments are healthy.
7. The production Connections acceptance harness completes every check successfully on `v2seed` and leaves only governed deprecated acceptance evidence.

After those gates pass, any remaining work is external-provider onboarding data (URLs, IDs, credentials, webhook registration), not a pending Connections architecture/UI/runtime implementation gap.
