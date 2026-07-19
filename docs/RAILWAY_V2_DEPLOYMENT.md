# Railway V2 Deployment

This document prepares EIP Core V2 for Railway without deploying it.

V2 is a kernel/process/UI-engine system. Railway deployment must not introduce module-driven shortcuts, route-owned business authority, hardcoded UI behavior, or secrets in Git.

## Current service layout

- Repository root: `D:\Projects\EIP\eip-core-v2`
- API service root inside repo: `services/api`
- Workbench UI root inside repo: `apps/workbench-ui`
- Database migrations: `db/migrations`
- API healthcheck: `/api/public/health`
- Optional DB healthcheck: `/api/public/health/db` when `ENABLE_PUBLIC_DB_HEALTH=true`

## Recommended Railway topology

Use separate Railway services:

1. PostgreSQL database service.
2. EIP Core V2 API service.
3. Workbench UI service, if the UI is hosted on Railway rather than another static host.

For the API service, keep the Railway service root as the repository root so `services/api/scripts/apply_v2_migrations.mjs` can still read `db/migrations`.

## Railway API config template

The API config template is:

```txt
deploy/railway.api.json
```

In Railway, configure the API service to use this config file path if you want config-as-code for the API service:

```txt
/deploy/railway.api.json
```

The template sets:

- builder: `RAILPACK`
- build command: `cd services/api && npm ci`
- start command: `cd services/api && npm run start`
- healthcheck path: `/api/public/health`

Do not point a Workbench UI/static service at this API config.

## Create Railway project

1. Create a new Railway project.
2. Add a PostgreSQL service.
3. Add a GitHub-connected service for this repository.
4. Use the API config file path above for the API service, or manually set the same build/start/healthcheck settings.
5. Add required environment variables.
6. Run migrations against the Railway PostgreSQL database before opening production traffic.
7. Confirm `/api/public/health` returns `200`.

## Required API variables

Set these in Railway for the API service:

```txt
NODE_ENV=production
HOST=0.0.0.0
LOG_LEVEL=info
TRUST_PROXY=true
CORS_ORIGIN=https://<workbench-domain>
CORS_CREDENTIALS=true
DATABASE_URL=${{Postgres.DATABASE_URL}}
DATABASE_SSL=true
AUTH_SESSION_PEPPER=<strong random secret>
AUTH_CSRF_PEPPER=<strong random secret>
AUTH_DEVICE_PEPPER=<strong random secret>
AUTH_OTP_PEPPER=<strong random secret>
AUTH_TOTP_SECRET_KEY=<64 hex chars>
AUTH_TOTP_ISSUER=EIP
AUTH_COOKIE_SECURE=true
AUTH_COOKIE_SAMESITE=lax
AUTH_COOKIE_PATH=/
AUTH_CSRF_REQUIRE_ORIGIN=true
AUTH_SESSION_TTL_MIN=720
AUTH_SESSION_IDLE_TTL_MIN=120
AUTH_SESSION_TOUCH_INTERVAL_SEC=300
AUTH_SESSION_BIND_USER_AGENT=true
AUTH_DEVICE_COOKIE_NAME=did
AUTH_DEVICE_COOKIE_DAYS=90
AUTH_REQUIRE_TOTP_FOR_PRIVILEGED=true
AUTH_OTP_TTL_SEC=600
AUTH_OTP_MAX_ATTEMPTS=6
AUTH_LOGIN_FAILURE_THRESHOLD=8
AUTH_LOGIN_LOCK_MIN=15
LOG_DEV_OTP=false
SMTP_HOST=<smtp host if OTP email is enabled>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<smtp user>
SMTP_PASS=<smtp secret>
SMTP_FROM=<sender address>
REQUEST_ACCESS_TO=<owner/admin email if request access mail is enabled>
ENABLE_PUBLIC_DB_HEALTH=false
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=1 minute
```

Railway injects `PORT`; do not hardcode it unless Railway service settings require an override.

Do not commit any real values.

## Workbench UI variables

If Workbench UI is deployed separately:

```txt
VITE_API_BASE_URL=https://<api-domain>
```

Build command:

```txt
cd apps/workbench-ui && npm ci && npm run build
```

Static output directory:

```txt
apps/workbench-ui/dist
```

## Migration procedure

Run migrations from the repository root context, or from `services/api` with the repo still available:

```powershell
cd D:\Projects\EIP\eip-core-v2\services\api
npm run migrate:v2
```

On Railway, run the equivalent command after variables are set:

```bash
cd services/api && npm run migrate:v2
```

The migration script uses `DATABASE_URL` when present, otherwise the `DATABASE_*`/`DB_*` variables. It reads migration files from `db/migrations`.

Do not add new V2 business tables as part of deployment bootstrap. New tables must pass the V2 DB checklist and justification register.

## Healthcheck

Railway healthcheck path:

```txt
/api/public/health
```

Expected response:

```json
{ "ok": true, "service": "api" }
```

DB health is optional:

```txt
/api/public/health/db
```

Only enable it publicly when acceptable for that environment.

## Rollback note

If a deploy is unhealthy:

1. Roll back the Railway service to the previous deployment.
2. If migrations already ran, restore the database from the latest known-good backup/snapshot.
3. Re-run `/api/public/health`.
4. Re-run smoke tests before opening traffic again.

Do not use destructive database rollback commands without an explicit backup/restore plan.

## Validation before deployment

Before connecting Railway production:

```powershell
git status --short
cd services/api
npm test
cd ..\..\apps\workbench-ui
npm run build
```

If a Railway deployment target is not already confirmed, stop after pushing GitHub and configure Railway manually.
