# WAVE_3A_CLOSEOUT

Date: 2026-03-27

## Scope executed

Wave 3A only:

- `core/core_process_engine.js` migrated into V2 and adapted.
- `routes/core_process.js` migrated as thin re-export.
- `routes/process/core_process.js` migrated into V2 and adapted.

Excluded in this wave:

- `routes/crm_process.js` migration
- storefront/ecom/public commerce
- gateway rewrite

## Key adaptations

- Removed direct dependency on legacy `auth/perm.js`.
- Process routes now require authenticated EIP session + CSRF and enforce same-tenant scope in Wave 3A.
- Added process-schema readiness gate that returns `503 PROCESS_SCHEMA_UNAVAILABLE` with missing table list when process tables are not yet migrated.
- Kept process engine transition/effect model intact and fail-closed for unavailable gateway outbound effect module.
- Added optional fallback for missing `eip_auth.auth_identity_agent` mapping (`actor_agent_id = null`).

## Runtime status

- API boot: pass
- Auth routes: pass
- Process routes registered under:
  - `/api/eip/core/process/*`
  - `/api/eip/process/*`
- Current process-route runtime behavior in V2 DB: returns `503 PROCESS_SCHEMA_UNAVAILABLE` until process schema migrations are present.

## Security and drift notes

- No V1 files were modified.
- No new table was created in Wave 3A.
- No direct lifecycle mutation bypass was added in route handlers.
- Process actions remain delegated to `core_process_engine` functions.

## Next gate

- Wave 3A is code-integrated but data-plane gated by missing `eip_core` process tables.
- Wave 3B should proceed only if CRM migration plan includes process-schema compatibility path or explicit V2 process schema migration batch.
