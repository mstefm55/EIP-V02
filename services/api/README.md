# API Service Scaffold

This directory is the backend API contract and security shell for EIP Core V2.

## Scope

- Central tenant context resolution contract
- Central authorization shell contract
- Response boundary rules
- Safe data access rules
- Lightweight middleware and DB mapping helpers

## Operating rules

- Tenant context is explicit and server-derived.
- Authorization is deny-by-default.
- DB access is tenant-scoped.
- API responses are bounded and sanitized before leaving the service.
- Raw database rows, secrets, tokens, and internal-only fields never cross the API boundary.

## File map

- `src/contracts/tenant-context-contract.md`
- `src/contracts/api-db-mapping-rules.md`
- `src/security/authorization-shell.md`
- `src/security/response-boundary-rules.md`
- `src/security/safe-data-access-rules.md`
- `src/middleware/tenantContextResolver.js`
- `src/middleware/authorizeAction.js`
- `src/middleware/responseBoundary.js`
- `src/db/tenantQuery.js`
- `src/index.js`

## Implementation posture

This is scaffolding only.

- Keep the contracts explicit.
- Keep the middleware thin.
- Prefer fail-closed defaults.
- Do not expose direct SQL results to frontend callers.

## Wave 2.5 runtime alignment

1. Copy `services/api/.env.v2.example` to `services/api/.env.v2.local` and set real secrets.
2. Ensure `DB_DATABASE` points to the migrated V2 database (default `eip_V2` in the example file).
3. Apply migrations up to `db/migrations/v2_0004_auth_shell_foundation.sql`.
4. Seed minimum auth bootstrap data:
   - `V2_BOOTSTRAP_PASSWORD=<strong-password> node scripts/bootstrap_v2_auth_seed.mjs`

The `npm run dev` and `npm run start` scripts load `services/api/.env.v2.local` automatically when it exists.
