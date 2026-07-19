# V2 Staging Deployment Runbook

This directory defines the repeatable staging deployment foundation for V2.

## Topology

Single-origin staging shape:

1. API runtime on `http://127.0.0.1:4000`
2. Reverse-proxy gateway on `https://localhost:8443` (loopback host by default)
3. Workbench UI served as built static assets from `apps/workbench-ui/dist`
4. Browser talks only to the gateway origin (`/api/*` is proxied upstream)

Why this topology:
- avoids avoidable cross-origin/session fragility
- keeps current auth cookie + CSRF model stable
- keeps secure-cookie + CSRF behavior validated in a TLS path
- remains provider-agnostic and easy to translate later to NGINX/Caddy/ingress

## Required files

- `services/api/.env.v2.staging` (copy from `services/api/.env.v2.staging.example`)
- `deploy/staging/.env.staging` (copy from `deploy/staging/.env.staging.example`)
- For full browser smoke including authoring paths, keep `RATE_LIMIT_MAX` at least `1000` in staging API env.
- `STAGING_SMOKE_SHARED_PASSWORD` must satisfy password policy (min 12, upper, lower, number, symbol).

## TLS behavior

- `staging_gateway.mjs` runs in TLS mode by default (`STAGING_TLS_ENABLED=true`).
- If cert/key files are missing, the gateway auto-generates local TLS assets with OpenSSL at:
  - `deploy/staging/certs/localhost.crt`
  - `deploy/staging/certs/localhost.key`
- To disable auto-generation, set `STAGING_TLS_AUTOGENERATE=false` and provide cert/key paths explicitly.
- Optional HTTP redirect listener can be enabled with `STAGING_HTTP_REDIRECT_PORT` (empty by default to avoid port conflicts).

## One-time install

1. `cd C:\Projects\EIP\eip-core-V2\services\api`
2. `npm install`
3. `cd C:\Projects\EIP\eip-core-V2\apps\workbench-ui`
4. `npm install`
5. `npx.cmd playwright install chromium`

## Staging startup order (required)

1. Apply migrations (authoritative order):
`cd C:\Projects\EIP\eip-core-V2\services\api`
`node --env-file-if-exists=.env.v2.staging scripts/apply_v2_migrations.mjs`
This migration entrypoint is replay-safe for already-applied V2 foundations and reports `applied` vs `skipped`.

2. Build workbench assets:
`cd C:\Projects\EIP\eip-core-V2\apps\workbench-ui`
`npm run build`

3. Start API + gateway:
`cd C:\Projects\EIP\eip-core-V2`
`node deploy/staging/staging_stack.mjs`

4. Keep that process running and open staging:
`https://localhost:8443`

## Seed smoke identities (staging)

Use the same shared password configured in both:
- `services/api/.env.v2.staging` (`STAGING_SMOKE_SHARED_PASSWORD`)
- `deploy/staging/.env.staging` (`STAGING_SMOKE_SHARED_PASSWORD`)

Then run:

1. `cd C:\Projects\EIP\eip-core-V2\services\api`
2. `npm run seed:staging:smoke`

If password policy fails, the script now returns an explicit actionable error and points to both env files.

## Repeatable staging smoke

With API + gateway running:

1. `cd C:\Projects\EIP\eip-core-V2`
2. `node --env-file-if-exists=deploy/staging/.env.staging deploy/staging/staging_smoke.mjs`

This smoke run validates:
- `/api/public/health` and `/api/public/health/db`
- UI shell availability from gateway origin
- unauthenticated fail-closed (`whoami` 401)
- authenticated core + ecom workbench UI rendering via browser automation
- workbench contract calls through proxied `/api/eip/process/workbench/*`
- permission fail-closed UI behavior for limited user
- cookie/session/CSRF behavior (sid httpOnly, csrf cookie, csrf-required logout)
- by default excludes the heavier authoring mutation smoke; set `E2E_INCLUDE_AUTHORING=true` to include it
- when TLS is self-signed locally, smoke sets `NODE_TLS_REJECT_UNAUTHORIZED=0` unless `STAGING_SMOKE_ALLOW_INSECURE_TLS=false`

Static deployment artifact sanity check:
- `cd C:\Projects\EIP\eip-core-V2`
- `node scripts/validate_staging_deployment.mjs`

## Rollback basics (staging)

If deployment becomes unhealthy:

1. Stop stack (`Ctrl+C` in `staging_stack.mjs` terminal).
2. Restore previous API env/build artifacts if changed.
3. Restore DB from staging backup snapshot if migration/data state is bad.
4. Re-run migration to known-good point if needed.
5. Re-run staging smoke before re-opening environment.

No destructive DB commands are required for normal rollback.
