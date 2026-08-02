# V2 Tenant RLS Wave 2A Implementation

Date: 2026-08-02

Status: implemented locally; not committed, not pushed, not deployed.

Starting branch/SHA:

- `main`
- `a4da3d141bf3aa55c6ba3ff26da2ebb0cfd00fb6`

## Scope

Wave 2A implements the first fail-closed tenant RLS slice:

- shared transaction-local tenant helper
- `tenant.tenant_settings` runtime access through the helper
- forward-only migration forcing RLS on `tenant.tenant_settings`
- tests and validator checks for the selected slice

This wave intentionally does not enable RLS on auth, process, dropdown, or UI surface tables.

## Selected table group

Selected:

- `tenant.tenant_settings`

Rationale:

- It has a mandatory direct `tenant_id`.
- It already had RLS enabled from `v2_0003_tenant_settings_rls.sql`.
- It had one active API read path in `services/api/src/routes/ui_surface.js`.
- The call path can be wrapped in one transaction without broad auth/session/process rewrites.

Deferred:

- `security.tenant_memberships`: already RLS-enabled, but it is a security/bootstrap table and needs privileged onboarding semantics before FORCE RLS.
- `eip_auth.*`: session/login bootstrapping must be designed before RLS can be enabled safely.
- `eip_core.process_*`, `task`, `service_object`, and events: process engine call sites need a broader client-threading wave.
- `eip_core.dropdown_list` and `dropdown_value`: nullable/global plus indirect tenancy needs special policies.
- `eip_core.ui_surface`: nullable/global public metadata semantics need DTO and global-fallback review before RLS.

## Transaction helper

File:

- `services/api/src/db/tenantTransaction.js`

Behavior:

1. Validate `tenantId` as UUID before opening a database client.
2. Lease one pool client.
3. `BEGIN`.
4. Run `SELECT set_config('app.current_tenant_id', $1, true)` with a bound parameter.
5. Execute the callback using the same leased client.
6. `COMMIT` on success.
7. `ROLLBACK` on failure.
8. Always release the client.

Nesting rule:

- Nested tenant transactions are not supported.
- Code already inside a tenant transaction must accept and reuse the provided `client`.
- Do not call `withTenantTransaction` from inside another tenant transaction.

Security properties:

- Missing tenant context fails before any client is opened.
- Malformed tenant context fails before any client is opened.
- Tenant context is transaction-local and clears after commit/rollback.
- Tenant IDs are passed as parameters, never interpolated into SQL.

## Request / realm integration

Private `/api/eip` UI surface routes use `s.session.tenant_id`, which is trusted server-side session context.

Public UI surface routes no longer use raw query-string `tenant_id` as tenant context for the selected `tenant_settings` access path. They may resolve a tenant from `tenant_code`, which is the approved public handle in this wave. This keeps public tenant context resolution explicit and avoids turning a client-supplied UUID into tenant RLS authority.

## Migration

File:

- `db/migrations/v2_0032_tenant_settings_force_rls.sql`

Actions:

- `ENABLE ROW LEVEL SECURITY`
- `FORCE ROW LEVEL SECURITY`
- replace the legacy all-operations policy with explicit operation policies:
  - `tenant_settings_select_isolation`
  - `tenant_settings_insert_isolation`
  - `tenant_settings_update_isolation`
  - `tenant_settings_delete_isolation`

Policy predicate:

```sql
tenant_id = security.current_tenant_id()
```

Missing `app.current_tenant_id` resolves to null through `security.current_tenant_id()`, so tenant rows are not visible and writes fail.

## Role assumptions

- Normal API traffic uses the application database role.
- The application role must not have `BYPASSRLS`.
- Migrations may run with schema-owner authority through the migration runner.
- Privileged/system cross-tenant access is not introduced in this wave.
- FORCE RLS behaviour must be verified against a disposable local database role representative of the application before commit/deployment acceptance.

## Rollback strategy

This is a forward-only V2 migration chain.

Deployment order:

1. Preferred: deploy code and migration together through the normal migration-ledger deployment path after disposable DB integration passes.
2. Application code before migration is safe for `tenant_settings` reads because the helper sets transaction-local context while the older RLS policy remains enabled.
3. Migration before application code is not recommended because legacy pooled `app.db.query` paths would have no transaction-local tenant context under FORCE RLS.
4. Health checks must stay on global/non-tenant endpoints and must not depend on `tenant.tenant_settings`.

If rollback is required before production promotion:

1. Restore the target environment from the pre-wave backup/snapshot.
2. Replay migrations only up to the desired ledger point.
3. Do not edit applied migration files.

If rollback is required after deployment, use restore-and-replay. Do not manually disable RLS in production as a silent workaround.

Emergency handling:

- Do not temporarily remove tenant context helper calls to “fix” reads; that reintroduces unscoped access.
- If an emergency policy change is unavoidable, it must be explicit, audited, and followed by restore/replay remediation.
- Do not add a global bypass policy or `isSystem` flag in application code.

## Tests

Default API tests include:

- valid tenant transaction commit path
- same-client callback use
- rollback and release on callback failure
- missing/invalid tenant fail before opening a client
- transaction-local tenant state clears after commit/rollback
- pool reuse does not leak tenant context
- tenant context SQL is parameterized
- `ui_surface` tenant setting reads use `withTenantTransaction`
- public direct `tenant_id` is ignored unless a trusted server-side caller opts into direct tenant use
- public `tenant_code` resolution still works

Disposable DB integration suite:

```powershell
$env:EIP_RLS_TEST_DATABASE_URL='postgresql://eip_v2_rls_app:<password>@localhost:5432/eip_v2_rls_test'
npm.cmd --prefix services/api run test:tenant-rls
```

Safety guard:

- The integration suite refuses non-local databases unless `EIP_RLS_TEST_ALLOW_REMOTE=true`.
- It is intended only for disposable local PostgreSQL databases.
- The integration suite refuses `eip_V2` and only runs against `eip_v2_rls_test`.
- The integration suite asserts `current_user` is the URL role, non-superuser, and non-`BYPASSRLS`.
- The integration suite asserts `tenant.tenant_settings` has RLS enabled, FORCE RLS enabled, and exactly the expected Wave 2A policy names.
- The integration suite now covers all required DB cases: missing context, same-tenant insert/select/update/delete, cross-tenant insert/select/update/delete rejection, tenant_id reassignment rejection, COMMIT and ROLLBACK context reset, pool reuse without context leakage, safe tenant B context after tenant A reuse, FORCE RLS on the table-owner application role, and SQL-failure rollback without leaked context.

## Validator coverage

`scripts/validate_tenant_scope.mjs` now checks:

- the Wave 2A FORCE RLS migration exists
- the migration contains the expected table, FORCE RLS clause, policies, and `security.current_tenant_id()`
- `tenant.tenant_settings` is not queried through pooled `app.db.query`

## Production safety notes

- Existing production data is not deleted or recreated.
- No seed data is added.
- No existing migration is edited.
- No V1 file is modified.
- The only DB behavior change is the forward-only FORCE RLS policy set for `tenant.tenant_settings`.

## Next RLS wave

Recommended next group after Wave 2A acceptance:

1. `security.tenant_memberships`, only after explicit privileged onboarding/system semantics are designed.
2. Then auth tables (`eip_auth.auth_identity`, `auth_credential`, `auth_session`, `auth_device`, `auth_otp_challenge`) in a separate auth-bootstrap wave.

Do not jump directly to process tables until auth/session tenant context is proven.
