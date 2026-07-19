# WAVE_3_5_CLOSEOUT

Date: 2026-03-28

## Scope completed

Wave 3.5 only:

- Added the minimum V2 process schema/data-plane foundation for migrated process routes.
- Seeded required governed process/task/status taxonomy dropdowns.
- Added `eip_auth.auth_identity_agent` mapping table required for transaction-safe actor lookup in process execution.
- Verified process routes no longer fail with `PROCESS_SCHEMA_UNAVAILABLE`.

Excluded in this wave:

- CRM process route migration (`crm_process.js`)
- storefront/ecom/public commerce migration
- V1 modifications

## Migration status

Applied in `eip_V2`:

- `db/migrations/v2_0005_process_schema_foundation.sql`
- `db/migrations/v2_0006_process_taxonomy_seed.sql`
- `db/migrations/v2_0007_auth_identity_agent_link.sql`

Rerun check:

- All three migrations replayed without fatal errors (`IF NOT EXISTS`/upsert behavior verified).

## Core relations established

Created:

- `eip_core.agent`
- `eip_core.service_object`
- `eip_core.service_object_party`
- `eip_core.dropdown_list`
- `eip_core.dropdown_value`
- `eip_core.process_def`
- `eip_core.process_binding`
- `eip_core.task_template`
- `eip_core.task`
- `eip_core.process_instance`
- `eip_core.service_object_status_event`
- `eip_core.task_status_event`
- `eip_auth.auth_identity_agent`

Compatibility relation:

- `eip_core.process_task_template` (view over `eip_core.task_template` for staged readiness compatibility)

## Operational verification

Smoke checks against V2 runtime:

- `GET /api/public/health` -> 200
- `GET /api/public/health/db` -> 200
- `GET /api/eip/auth/whoami` (session) -> 200
- `GET /api/eip/process/taxonomy` -> 200
- `GET /api/eip/core/process/taxonomy` -> 200
- `POST /api/eip/process/defs` -> 200
- `POST /api/eip/process/instances` -> 200
- `POST /api/eip/process/instances/:id/advance` -> 200
- DB verification confirmed persisted `process_instance` row and emitted `service_object_status_event` row.

`PROCESS_SCHEMA_UNAVAILABLE` gate status:

- Resolved (required relations now present).

## Drift/safety notes

- No V1 files modified.
- No business-specific convenience table introduced.
- Lifecycle mutation still executed through process engine transitions/effects.
- New table register updated with kernel/engine/security justification and drift checks.

## Wave 3B gate decision

- Wave 3.5 gate: **PASS**
- V2 ready for Wave 3B (`crm_process` migration): **YES**
