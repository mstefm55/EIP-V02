# WAVE_2_5_CLOSEOUT

Date: 2026-03-26

## Scope completed

- Runtime DB alignment moved V2 API execution to `eip_V2`.
- Auth shell persistence foundation added for `eip_auth` in V2 migration chain.
- Minimal tenant + identity + password bootstrap path added and executed.
- Auth smoke tests completed against V2 runtime DB.

## Implemented artifacts

- `db/migrations/v2_0004_auth_shell_foundation.sql`
- `scripts/bootstrap_v2_auth_seed.mjs`
- `services/api/scripts/bootstrap_v2_auth_seed.mjs`
- `services/api/.env.v2.example`
- `services/api/.env.v2.local` (local runtime file, gitignored)

## Migration status

- `v2_0001_kernel_bootstrap.sql` applied in `eip_V2`
- `v2_0002_security_memberships.sql` applied in `eip_V2`
- `v2_0003_tenant_settings_rls.sql` applied in `eip_V2`
- `v2_0004_auth_shell_foundation.sql` applied in `eip_V2`

## Seed status

- Tenant seeded: `v2seed`
- Identity seeded: `v2.admin`
- Password credential seeded with `argon2id`

## Operational verification

- `GET /api/public/health` -> 200
- `GET /api/public/health/db` -> 200
- `GET /api/eip/auth/whoami` (anonymous) -> 401 (expected)
- `POST /api/eip/auth/logout` (anonymous) -> 401 (expected)
- `POST /api/eip/auth/login/password` -> 200
- `GET /api/eip/auth/whoami` (session) -> 200
- `POST /api/eip/auth/logout` (session + CSRF) -> 200

## Wave 3 gate decision

- Wave 2.5 operational gate: **PASS**
- V2 ready to start Wave 3 process engine migration: **YES**

## First Wave 3 backend files

- `C:\Projects\EIP\eip-core\services\api\src\core\core_process_engine.js`
- `C:\Projects\EIP\eip-core\services\api\src\routes\core_process.js`
- `C:\Projects\EIP\eip-core\services\api\src\routes\process\core_process.js`
- `C:\Projects\EIP\eip-core\services\api\src\routes\crm_process.js`
