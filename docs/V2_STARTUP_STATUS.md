# EIP Core V2 Startup Status

Updated: 2026-07-19

## Scope checked

Path checked:

```txt
D:\Projects\EIP\eip-core-v2
```

V1 was not inspected or modified for this bootstrap.

## Repository state

- Git initialized: yes
- Current branch at inspection: `master`
- Initial commit present at inspection: no
- Remote origin at inspection: none
- Normal Git commands require a per-command safe-directory override on this Windows-mounted path:

```bash
git -c safe.directory=D:/Projects/EIP/eip-core-V2 <command>
```

## Folder structure

- `services/api` — Fastify API runtime, auth shell, process routes, UI surface routes, health routes.
- `apps/workbench-ui` — Vite/React Workbench UI.
- `db/migrations` — V2 SQL migrations.
- `db/sql` — supporting SQL drafts/schema captures.
- `deploy/staging` — local/staging gateway, stack runner, smoke runner, staging env examples.
- `docs` — architecture, Codex continuity, DB, and developer guardrails.
- `scripts` — repository-level validation scripts.
- `.github/workflows` — security/governance gate workflow.

## Existing V2 governing docs

Present:

- `AGENTS.md`
- `AGENT_TASKS.md`
- `SECURITY_TARGET.md`
- `SECURITY_CHECKLIST.md`
- `DB_V2_STRATEGY.md`
- `docs/codex/ARCHITECTURE_GUARDRAILS.md`
- `docs/architecture/TASK_EFFECT_MODEL.md`
- `docs/dev/BANNED_PATTERNS.md`
- `docs/dev/NO_MERGE_GATES.md`
- `docs/db/NEW_TABLE_JUSTIFICATION_REGISTER.md`
- `docs/db/V2_MIGRATION_CHECKLIST.md`

Added during GitHub/Railway bootstrap:

- `docs/RAILWAY_V2_DEPLOYMENT.md`
- `docs/V2_TRANSFER_RULES.md`
- `docs/V2_STARTUP_STATUS.md`

## Runtime locations

- Backend service: `services/api`
- Frontend/workbench: `apps/workbench-ui`
- Database migrations: `db/migrations`

## Package manager and scripts

Package manager: npm.

API scripts:

```txt
cd services/api
npm run start
npm test
npm run migrate:v2
```

Workbench scripts:

```txt
cd apps/workbench-ui
npm run build
npm run test:smoke
```

No root package manager workspace was added during bootstrap.

## Healthcheck

Existing API healthcheck:

```txt
GET /api/public/health
```

Optional DB healthcheck:

```txt
GET /api/public/health/db
```

`/api/public/health/db` is only registered when `ENABLE_PUBLIC_DB_HEALTH=true`.

## Railway readiness

Added API Railway config template:

```txt
deploy/railway.api.json
```

Deployment documentation:

```txt
docs/RAILWAY_V2_DEPLOYMENT.md
```

The API Railway service should use repository root context so `services/api/scripts/apply_v2_migrations.mjs` can read `db/migrations`.

## Environment templates

Present before bootstrap:

- `services/api/.env.v2.example`
- `services/api/.env.v2.staging.example`
- `deploy/staging/.env.staging.example`

Added during bootstrap:

- `.env.example`

Local/staging env files remain ignored and must not be committed.

## Migration status

Existing migration command:

```txt
cd services/api
npm run migrate:v2
```

No migration was added during GitHub/Railway bootstrap.

## Business logic status

No V2 feature development was performed during this bootstrap.

No business table was added.

No V1 code was imported.

## Validation log

Validation results are recorded by the bootstrap operator after commands run.
