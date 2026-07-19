# EIP Core V2

V2 is the constitutional foundation for EIP Core: kernel-first, engine-first, multi-tenant, and governed by metadata.

## Core principles
- The service object is the kernel unit of managed work.
- The same service object exists at two abstraction levels: conceptual kernel concept and operational case instance.
- Business classes include agent/entity, asset, material, document, and money; any of them may become a service object when acted on as a case.
- Shared behavior must flow through reusable process, task/workflow, and UI/rendering engines.
- Core governed structures stay relational; flexible tenant/object payloads may use JSONB under governance.

## Start here
- `AGENTS.md`
- `AGENT_TASKS.md`
- `docs/codex/ARCHITECTURE_GUARDRAILS.md`
- `docs/codex/SERIAL_CONTEXT_INDEX.md`
- `docs/architecture/KERNEL_CANON.md`
- `docs/architecture/SERVICE_OBJECT_CANON.md`
- `docs/architecture/TASK_EFFECT_MODEL.md`
- `docs/architecture/UI_ENGINE_OWNERSHIP.md`

## What belongs here
- constitutional guidance
- architecture guardrails
- continuity notes for serial work
- implementation scaffolding for the V2 foundation

## What does not belong here
- tenant-specific hardcoding in shared code
- page-specific shortcuts that bypass engines
- duplicate schemas created for convenience

## Rendered Workbench Frontend
- V2 rendered workbench UI lives in `apps/workbench-ui`.
- It is UI-engine driven (surface loader + renderer + registry) and consumes governed contracts:
  - `/api/eip/ui/surfaces`
  - `/api/eip/ui/surfaces/:code`
  - `/api/eip/process/workbench/catalog`
  - `/api/eip/process/workbench/defs/:id`
- Supported governed surfaces:
  - `core_process_workbench`
  - `ecom_process_workbench`

## Staging Deployment Foundation
- Staging deployment runbook lives at `deploy/staging/README.md`.
- Single-origin staging shape is implemented via `deploy/staging/staging_gateway.mjs` in front of the API.
- Migration application is scriptable via `services/api/scripts/apply_v2_migrations.mjs`.
- Repeatable staging smoke is executable via `deploy/staging/staging_smoke.mjs`.

## GitHub / Railway Bootstrap
- Current V2 startup status: `docs/V2_STARTUP_STATUS.md`
- Railway deployment preparation: `docs/RAILWAY_V2_DEPLOYMENT.md`
- V1-to-V2 transfer guardrails: `docs/V2_TRANSFER_RULES.md`
- API Railway config template: `deploy/railway.api.json`
