# V2 Tenant RLS Design

Date: 2026-08-01
Updated: 2026-08-02

Status: design plus first implementation slice. Wave 2A implements transaction-local tenant context and FORCE RLS for `tenant.tenant_settings` only.

Goal: add fail-closed PostgreSQL row-level security for tenant-owned V2 data without breaking the kernel/process/UI-engine model or production migration ledger.

## Existing foundation

`db/migrations/v2_0001_kernel_bootstrap.sql` already defines:

- `security.current_tenant_id()`
- `current_setting('app.current_tenant_id', true)::uuid`
- null tenant context means tenant-scoped access should fail closed

RLS was initially enabled only on:

- `security.tenant_memberships`
- `tenant.tenant_settings`

Wave 2A now forces RLS on:

- `tenant.tenant_settings`

The remaining tenant-owned tables currently rely mostly on application-query tenant filters.

## Tenant-owned / tenant-related table inventory

Tables counted in this design: 21 tenant-owned or tenant-related tables across `eip_core`, `eip_auth`, `tenant`, and `security`.

| Table | Tenant column / relationship | Current application-level tenant filter | Current RLS state | Operations | Expected policy | Privileged/system exceptions | Bootstrap/onboarding considerations | API-key/EDI considerations | Migration order | Test requirements | Risk of enabling RLS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `security.tenant_memberships` | `tenant_id` | Auth shell checks membership by tenant/principal | Enabled in `v2_0002_security_memberships.sql` | select/insert/update/delete | `tenant_id = security.current_tenant_id()` with matching `WITH CHECK` | Owner/system maintenance role only through explicit privileged transaction | Needed to establish tenant access; bootstrap must use privileged transaction or controlled onboarding context | API-key principal resolution must set tenant before membership reads | Already enabled | Existing positive and missing-context negative tests | Low, already enabled |
| `tenant.tenant_settings` | `tenant_id` | Tenant setting reads use `withTenantTransaction` in Wave 2A | Enabled in `v2_0003_tenant_settings_rls.sql`; FORCE RLS and operation policies added in `v2_0032_tenant_settings_force_rls.sql` | select/insert/update/delete | `tenant_id = security.current_tenant_id()` with matching `WITH CHECK` | System config jobs may use explicit tenant context per row | Tenant defaults may be inserted during controlled bootstrap | API/EDI must read only after tenant resolved | Implemented first slice | Unit tests plus disposable DB RLS integration script | Low, implemented in Wave 2A |
| `eip_auth.auth_identity` | `tenant_id` | Auth routes filter by tenant/login | Not enabled | select/insert/update | Tenant-bound reads/writes require current tenant | Bootstrap identity creation via privileged onboarding context | First identity creation must set tenant context before insert | API-key identity mapping must never read across tenants | Early auth block | Login positive/negative tenant crossover tests | High: login can fail if context is not set before credential lookup |
| `eip_auth.auth_credential` | `tenant_id`, FK to identity | Auth routes filter by tenant and identity | Not enabled | select/insert/update | Tenant-bound; secrets never selected into DTOs | TOTP/password setup via explicit context | Bootstrap password/TOTP setup must run inside tenant transaction | No direct EDI exposure | After `auth_identity` | Credential lookup, reset, TOTP tests | High: sensitive table; policy mistakes can break auth or leak hashes |
| `eip_auth.auth_session` | `tenant_id`, FK to identity | Session loader filters by tenant/session hash where available | Not enabled | select/insert/update/delete | Tenant-bound; session lookup must set context after safe session token lookup or use a controlled lookup function | Session cleanup job with explicit tenant batch context | Bootstrap session must set tenant context after tenant is known | API-key realm must not create human session bypass | After auth context helper | Session load/revoke/logout tests, missing context tests | High: bootstrapping tenant context from a session row needs careful design |
| `eip_auth.auth_identity_agent` | `tenant_id`, FK to identity and agent | Process actor lookup filters tenant | Not enabled | select/insert/update/delete | Tenant-bound | System actor mapping jobs with explicit context | Identity-agent links may be created during tenant onboarding | API-key principal-to-agent mapping requires tenant context | After `auth_identity` and `eip_core.agent` | Actor resolution tests | Medium: process engine can fail if context missing |
| `eip_auth.auth_device` | `tenant_id`, FK to identity | Auth route filters tenant/identity/token hash | Not enabled | select/insert/update | Tenant-bound; device token hashes never exposed | Cleanup/revocation jobs with explicit tenant context | Device trust elevation during bootstrap/login must set tenant | API-key flows generally should not use browser device trust | After auth/session context helper | Trusted/revoked device tests | High: affects login and revocation |
| `eip_auth.auth_otp_challenge` | `tenant_id`, FK to identity | Auth route filters tenant/identity/challenge | Not enabled | select/insert/update/delete | Tenant-bound; challenge values are hashed | Cleanup job with explicit tenant context | OTP during onboarding must set tenant before issuing challenge | Not applicable for EDI | After auth context helper | OTP issue/verify/replay/missing-context tests | High: false policy can break login or leak challenge metadata |
| `eip_core.agent` | `tenant_id` | Process routes/services filter tenant | Not enabled | select/insert/update/delete | Tenant-bound | System seeds iterate tenants with explicit `SET LOCAL` per tenant | Initial owner/admin agent may be created in bootstrap context | API-key actor mapping needs context | Start of eip_core RLS block | Agent tenant crossover tests | Medium |
| `eip_core.service_object` | `tenant_id` | Process engine queries filter tenant | Not enabled | select/insert/update/delete | Tenant-bound | Migration/seed system operations with explicit tenant context | Onboarding-created service objects require tenant context | EDI ingress must resolve tenant before object creation | After `agent` | Service object cross-tenant negative tests | High: kernel object table |
| `eip_core.service_object_party` | `tenant_id`, FKs to service object/agent | Process services filter tenant | Not enabled | select/insert/update/delete | Tenant-bound | System process repair with explicit context | Parties created during onboarding/process start | EDI/API-key can attach parties only within resolved tenant | After `service_object` and `agent` | Party insert/select tenant tests | Medium |
| `eip_core.dropdown_list` | Nullable `tenant_id`; null means platform/global list | Metadata queries may include tenant or global fallback | Not enabled | select/insert/update/delete | Tenant rows: `tenant_id = current`; global rows selectable when `tenant_id IS NULL`; writes to global require system role | System only for global catalog writes | Tenant defaults may clone/override global values | API/EDI reads governed lists after tenant resolved | Before dropdown values | Tenant override/global fallback tests | High: nullable tenant semantics need explicit policy |
| `eip_core.dropdown_value` | No direct tenant column; relationship through `list_id` to `dropdown_list` | Queries join/filter through list | Not enabled | select/insert/update/delete | Policy must use `EXISTS` on parent `dropdown_list` with current tenant/global rules, or future justified denormalized `tenant_id` | System global value writes only | Tenant-specific values inherit parent list context | API/EDI taxonomy reads after tenant resolved | After `dropdown_list`; special policy | Parent-list RLS tests, orphan prevention tests | High: no direct tenant_id makes policy more complex |
| `eip_core.process_def` | `tenant_id` | Process routes filter tenant | Not enabled | select/insert/update/delete | Tenant-bound | System seeds loop each tenant with explicit context | Tenant bootstrap may create default process definitions | API/EDI can only use active definition for resolved tenant | After dropdown taxonomy | Process definition tenant tests | High: lifecycle authority table |
| `eip_core.process_binding` | `tenant_id` | Process engine filters tenant/object type | Not enabled | select/insert/update/delete | Tenant-bound | System seeds/repairs with explicit context | Defaults created per tenant | EDI/API-key object routing must resolve tenant before binding lookup | After `process_def` | Binding tenant/is_active tests | High: wrong binding can route cross-tenant work |
| `eip_core.task_template` | `tenant_id` | Process engine filters tenant/process | Not enabled | select/insert/update/delete | Tenant-bound | System seeds/repairs with explicit context | Defaults created per tenant | API/EDI task creation after tenant resolved | After `process_def` | Template tenant tests | Medium |
| `eip_core.task` | `tenant_id` | Process routes filter tenant/task id | Not enabled | select/insert/update/delete | Tenant-bound | System background jobs with explicit tenant context | Onboarding tasks need tenant context | API/EDI may create/update tasks only in tenant context | After templates/instances | Task update tenant negative tests | High: user-visible workflow state |
| `eip_core.process_instance` | `tenant_id` | Process engine filters tenant/object/process | Not enabled | select/insert/update/delete | Tenant-bound | System background jobs with explicit tenant context | Onboarding process instances need tenant context | EDI/API-key may start instances only after tenant resolved | After process definitions/bindings | Instance start/advance tenant tests | High: lifecycle authority |
| `eip_core.service_object_status_event` | `tenant_id` | Event writes include tenant | Not enabled | select/insert/delete | Tenant-bound append-only; update should generally be disallowed or system-only | System repair only | Onboarding events require tenant context | EDI/API-key events after tenant resolved | After service object | Append/select tests; no cross-tenant history | Medium |
| `eip_core.task_status_event` | `tenant_id` | Event writes include tenant | Not enabled | select/insert/delete | Tenant-bound append-only; update should generally be disallowed or system-only | System repair only | Onboarding events require tenant context | EDI/API-key events after tenant resolved | After task | Append/select tests; no cross-tenant history | Medium |
| `eip_core.ui_surface` | Nullable `tenant_id`; null means platform/global surface | Surface route uses tenant/global lookup depending endpoint | Not enabled | select/insert/update/delete | Tenant rows: current tenant; global published surfaces selectable where intended; global writes system-only | Owner-admin profile publishing may be system/global with governed event | Tenant override surfaces need tenant context | Public surfaces must resolve tenant safely before tenant rows are visible | Late in eip_core block after contract DTO review | Surface global fallback + tenant override tests | High: public UI metadata can leak tenant UI if policy is wrong |

Non-tenant registry tables:

- `kernel.tenants` is the tenant registry and not tenant-owned in the same sense.
- `security.principals` is principal identity infrastructure, not tenant-owned; relationships become tenant-scoped through `security.tenant_memberships`.
- `eip_core.ui_shell_profile`, `eip_core.ui_shell_profile_revision`, and `eip_core.ui_shell_profile_event` are current platform/profile governance tables without direct tenant ownership. Tenant override semantics should be reviewed separately before adding RLS.

## Request and transaction model

All tenant-bound API execution should use a single shared helper. Wave 2A implements this as `services/api/src/db/tenantTransaction.js`:

```txt
withTenantTransaction(pool, tenantId, callback)
  BEGIN
  SELECT set_config('app.current_tenant_id', tenantId, true)
  callback(client)
  COMMIT
```

Requirements:

- The tenant context must be set with transaction-local scope only (`SET LOCAL` or `set_config(..., true)`).
- Tenant-bound SQL must run inside the same transaction/client where context is set.
- The pooled connection must never retain tenant state after commit/rollback.
- Missing tenant context for tenant-owned tables must fail closed.
- Route handlers must not use ad hoc `pool.query(...)` for tenant-bound data after RLS is enabled.
- The helper should reject empty, malformed, or unauthorized tenant IDs before starting tenant-bound work.
- Nesting rule: nested tenant transactions are not supported. Tenant-bound routines that are already inside a tenant transaction must accept and reuse the provided `client` instead of calling `withTenantTransaction` again.

## Tenant resolution sequence

1. Public unauthenticated endpoints must first resolve tenant from a safe non-sensitive handle, such as an approved tenant code/suffix, without exposing tenant-owned rows.
2. Browser `/api/eip` endpoints use session cookies to load a minimal session context. Session bootstrapping requires careful handling because `auth_session` is itself tenant-owned; use a controlled lookup path or function that validates session token hash and then sets tenant context for all subsequent reads.
3. API-key/EDI endpoints validate the raw key by hash/pepper or equivalent lookup, resolve tenant and principal, then set tenant context before any tenant-owned access.
4. System/bootstrap jobs must declare privileged execution explicitly and either loop per tenant with context or use a migration/owner role path reserved for schema/setup operations.

## Privileged and system exceptions

Allowed exceptions must be explicit, tested, and auditable:

- Migration runner: schema owner/migration role, not application request traffic.
- Seed/bootstrap: controlled bootstrap command only; not normal API runtime.
- Background jobs: per-tenant loop with explicit context. Cross-tenant jobs should never rely on missing RLS context.
- Platform global metadata rows (`tenant_id IS NULL`): selectable only where intended; writes require system authority.

## Public endpoint considerations

Public endpoints must not set tenant context from arbitrary request fields. They must:

- Resolve tenant through an approved public handle.
- Avoid exposing unpublished/private tenant rows.
- Use DTOs rather than raw database rows.
- Avoid using `/api/public` metadata as a backdoor into `/api/eip` tenant-owned surfaces.

Wave 2A applies this to owner-shell tenant settings: public UI surface routes no longer use a raw query-string `tenant_id` as tenant context. They may resolve tenant context through the approved public `tenant_code` handle, while private routes use the authenticated session tenant.

## API-key / EDI considerations

API-key or EDI flows must:

- Verify keys using hash/pepper or reference-only secret model.
- Resolve tenant before tenant-owned data access.
- Set `app.current_tenant_id` inside the request transaction.
- Record audit events without raw key/secret material.
- Keep browser session realm separate from machine/API-key realm.

## Migration order proposal

1. Add shared transaction helper and tests using existing RLS-enabled tables. Implemented in Wave 2A.
2. Wrap current tenant-bound routes/services with the helper for the selected table group. Wave 2A wraps `tenant.tenant_settings` owner-shell reads.
3. Enable RLS for auth identity/credential/session/device/OTP tables with careful session bootstrap design.
4. Enable RLS for core process tables in dependency order: agent, service object, parties, process definitions, bindings, templates, instances, tasks, events.
5. Enable taxonomy/list RLS, with special handling for nullable/global dropdown lists and indirect `dropdown_value` tenancy.
6. Enable UI surface RLS only after public/private DTO and global fallback semantics are tested.
7. Add no-merge validator coverage for tenant-owned tables without RLS or documented exemption.

## Test requirements

Each table needs at least:

- Same-tenant select succeeds.
- Cross-tenant select returns no row or fails.
- Insert/update with mismatched tenant fails.
- Missing `app.current_tenant_id` fails closed for tenant-owned rows.
- System/global exceptions require explicit privileged context.
- Connection-pool reuse cannot leak tenant context to the next request.

## Risks and mitigations

- Risk: auth session lookup becomes impossible if RLS is enabled before tenant context can be derived. Mitigation: design a narrow safe lookup function or two-stage session bootstrap that does not expose full session rows.
- Risk: global metadata rows with `tenant_id IS NULL` become unavailable. Mitigation: write explicit global-read policies and system-write policies.
- Risk: `dropdown_value` has no direct tenant column. Mitigation: parent-list policy through `dropdown_list`, or propose a denormalized tenant column in a dedicated migration with register justification.
- Risk: background jobs silently bypass or fail. Mitigation: require tenant-loop helper and tests for missing context.
- Risk: production data access breaks. Mitigation: implement in a dedicated wave with staging replay, no production DB mutation during design.

## Wave 2A implementation status

- New migration: `db/migrations/v2_0032_tenant_settings_force_rls.sql`.
- Helper: `services/api/src/db/tenantTransaction.js`.
- First table group: `tenant.tenant_settings` only.
- Existing migration history was not edited.
- No new tables were created.
- No production database was accessed.
- No seed was run.

## Explicit non-actions still in force

- No auth table RLS yet.
- No process table RLS yet.
- No `dropdown_list` / `dropdown_value` RLS yet.
- No `ui_surface` RLS yet.
- No privileged/system cross-tenant bypass path yet.

## Drift check

- Kernel-first: RLS protects tenant ownership without changing service object/process authority.
- Process model: process definitions, bindings, tasks, and instances remain governed tables.
- UI-engine: UI metadata remains DB-governed; public/private surface rules require DTO review before RLS rollout.
- Security/tenancy: design fails closed on missing context.
- Schema discipline: implementation is deferred to a dedicated migration wave with register review.
