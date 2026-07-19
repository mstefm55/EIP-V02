# WORKBENCH_OPERATOR_MANUAL

## Purpose

Operator guide for the V2 owner-admin workbench so you can review current behavior and propose targeted improvements.

## Runtime Access

1. API: `C:\Projects\EIP\eip-core-V2\services\api`
- run `npm run dev`
- default local port: `4010`

2. UI: `C:\Projects\EIP\eip-core-V2\apps\workbench-ui`
- run `npm run dev`
- open `http://localhost:5175/` (or your active Vite port)

3. Login (local seed)
- tenant code: `v2seed`
- login: `v2.workbench.admin` (TOTP-enabled) or `v2.admin`
- for `v2.workbench.admin`, password step-up requires TOTP verification

## Screen Map

1. Header (global shell)
- refresh current workspace
- account menu
- sign out

2. Left sidebar (surface navigation)
- process builder/workbench entry
- other available governed surfaces

3. Center workspace (process authoring)
- process library (select definition)
- builder canvas (task/node flow)
- transitions list

4. Right inspector panel (tabbed)
- `Definition`
- `Node Inspector`
- `Transition Inspector`
- `Task Templates`
- `Process Bindings`

## Core Process Authoring Flow

1. Select or create a process definition
- choose from **Process Library**
- use **Add** (if you have write permission)

2. Fill Definition tab
- `Code`, `Name`, `Module`, `Version`
- `Service Object Type`
- `Initial Node`
- `Active definition`

3. Build tasks in Builder Canvas
- apply a starter template (Quick Start) or add nodes manually
- choose node type and node label
- open node in `Node Inspector` to edit details

4. Wire transitions
- use transitions list + `Transition Inspector`
- set `From`, `To`, `Task Label`, `Macro`
- optional `Fallback Effect` exists for compatibility, but macro-driven design is preferred

5. Configure reusable macro/effect layer
- effects are governed by effect taxonomy (`PROCESS_EFFECT_TYPE`)
- runtime execution remains generic (`effect + service_object_type + service_object_category`)

6. Configure runtime reuse tabs
- `Task Templates`: governed reusable task shapes
- `Process Bindings`: binds process definitions to runtime entry points

7. Save and validate
- use `Save` in definition editor
- if invalid, warnings/errors are shown in-workbench

## 5-Layer Model Used In This Workbench

1. Process definition
2. Task label (business-facing)
3. Macro
4. Effect library
5. Service object type/category runtime parameters

This is the canonical model the UI is expected to preserve.

## What Is Engine-Owned vs Metadata-Owned

Engine-owned (code):
- renderer, primitive registry, safe contracts, validation boundaries

Metadata-owned (DB/governed):
- surface composition
- field labels/order/grouping
- task/node/transition structure
- macro/effect selection and process-specific shape

Server-owned authority:
- permission checks
- CSRF/session/device checks
- process legality, transition legality, effect legality

## Permissions You Need

- read definitions: `PROCESS_DEF_READ` (and related read scopes)
- create/update definitions: `PROCESS_DEF_WRITE`
- instances/workbench operations: corresponding `PROCESS_INSTANCE_*` scopes

Without write permission, authoring controls may appear read-only or unavailable.

## Troubleshooting

1. Login fails with correct password
- check whether account is TOTP-enabled (you may need TOTP step-up)
- reseed test account if lockout counters were reached

2. Save fails or process not visible
- verify required permissions
- verify process schema migrations are applied
- check API logs for explicit fail-closed reason

3. Unexpected UI behavior
- confirm selected surface and tenant context
- refresh workspace from header

## How To Propose Improvements (Recommended Format)

For each improvement request, provide:

1. Area
- `Library`, `Canvas`, `Node Inspector`, `Transition Inspector`, `Templates`, `Bindings`, `Header`, `Navigation`, `Login`

2. Current behavior
- exact current step and what happens

3. Target behavior
- exact expected behavior

4. Reason
- productivity, clarity, fewer clicks, fewer errors, governance clarity

5. Priority
- `P1` (critical), `P2` (important), `P3` (nice-to-have)

6. Acceptance check
- one short test statement proving completion

## Notes

- This manual is operator-focused. Architecture canon remains in:
  - `C:\Projects\EIP\eip-core-V2\docs\architecture\TASK_EFFECT_MODEL.md`
  - `C:\Projects\EIP\eip-core-V2\docs\architecture\UI_ENGINE_OWNERSHIP.md`
  - `C:\Projects\EIP\eip-core-V2\docs\architecture\KERNEL_CANON.md`
