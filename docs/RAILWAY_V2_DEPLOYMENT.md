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

Do not set the Railway Root Directory to `/services/api`. The Docker build context must remain the repository root because the API image intentionally includes both `services/api` and `db/migrations`.

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

- builder: `DOCKERFILE`
- Dockerfile path: `deploy/Dockerfile.api`
- Docker build context: repository root
- pre-deploy command: `cd /app/services/api && npm run migrate:v2`
- runtime command: Dockerfile `CMD ["npm", "run", "start"]`
- healthcheck path: `/api/public/health`

Do not point a Workbench UI/static service at this API config.

The API Dockerfile is:

```txt
deploy/Dockerfile.api
```

It uses Node 20, installs production API dependencies with `npm ci --omit=dev --prefix services/api`, copies `services/api`, and copies `db/migrations`. Local env files, logs, certs, build output, and dependency folders are excluded by the root `.dockerignore`.

## Create Railway project

1. Create a new Railway project.
2. Add a PostgreSQL service.
3. Add a GitHub-connected service for this repository.
4. Keep the Railway service root as the repository root.
5. Set the API service config file path to `/deploy/railway.api.json`.
6. Confirm the API service uses `deploy/Dockerfile.api` from the repository root Docker context.
7. Add required environment variables.
8. Let the configured pre-deploy command run migrations.
9. Confirm `/api/public/health` returns `200`.

Do not set Railway Root Directory to `/services/api`; doing that hides `db/migrations` from the migration runner.

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
cd /app/services/api && npm run migrate:v2
```

The Railway API config runs this as the pre-deploy command, after the Docker image is built and before the API container starts. The command executes inside the built API image, where both `/app/services/api` and `/app/db/migrations` are present.

The migration script uses `DATABASE_URL` when present, otherwise the `DATABASE_*`/`DB_*` variables. It reads migration files from `db/migrations` relative to the repository root structure copied into the image.

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
npm --prefix services/api test
node scripts/validate_staging_deployment.mjs
git diff --check
docker build -f deploy/Dockerfile.api -t eip-v2-api-test .
```

If a Railway deployment target is not already confirmed, stop after pushing GitHub and configure Railway manually.
