# EFFECT LIBRARY PRIMITIVE V1

Status: **EFFECT LIBRARY PRIMITIVE V1 — LOCKED**

Production source branch audited: `feature/route-temporal-gate-v1` at `10b99b8376fe9b73fe8ae290a303b9695490a8db`.

Repair/freeze chain: `v2_0036_primitive_effect_library_v1.sql`, `v2_0037_effect_catalogue_lockdown.sql`, `v2_0038_effect_library_primitive_v1_freeze.sql`.

This document is subordinate to `KERNEL_CANON.md`, `SERVICE_OBJECT_CANON.md`, `TASK_EFFECT_MODEL.md`, and `OPERATING_MODEL_CANON.md` and must be read with them.

## 1. Locked execution boundary

```text
PROCESS
  -> TASK LABEL / BUSINESS SEMANTICS
  -> MACRO
      -> GOVERNED REASONING / RESOLUTION (non-mutating)
      -> OBJECT_EFFECT PRIMITIVES (mutating)
  -> EXPLICIT GOVERNED KERNEL OBJECT FAMILY + RUNTIME PARAMETERS
  -> FINITE GENERIC CODE HANDLER
  -> GOVERNED MUTATION
```

Effects are not a catalogue of ERP/business actions.

Business names such as inventory move, consume, produce, convert, MRP, order approval, supplier approval, truck selection, work-order release, production scheduling, replenishment, allocation, hospital-bed assignment, patient transfer, barcode scanning or process scanning must remain Process/Macro/resolver semantics composed from domain-neutral reasoning and primitive mutations.

## 2. Primitive admission rule

A canonical Effect primitive must be:

1. domain-neutral;
2. reusable across unrelated industries;
3. reusable across unrelated Service Object categories;
4. a bounded mutation capability rather than business intention;
5. parameter-bounded and fail-closed;
6. free of workflow sequencing;
7. free of business eligibility decisions;
8. free of planning/reasoning decisions;
9. free of business-module identity;
10. executable by a finite generic reviewed handler.

Kernel object-family boundaries remain explicit. A universal arbitrary-table CRUD Effect is forbidden.

## 3. Reasoning and temporal boundary

Arithmetic, comparison, boolean, collection and bounded control-flow operators are reasoning capabilities, not Effects.

Current approved arithmetic/collection reasoning primitives include:

```text
ADD SUBTRACT MULTIPLY DIVIDE MOD
MIN MAX ABS ROUND FLOOR CEIL
EQ NE GT GTE LT LTE
AND OR NOT COALESCE
COUNT SUM FIRST LAST GET
```

Controlled language forms include bounded `IF`, `FILTER`, `SORT_BY`, loops and emits.

Date/time planning uses the governed temporal/calendar layer. Calendar resolution is timezone-aware and supports layered working intervals, exceptions/closures, next/previous working instant, add/subtract working time and working-time-between. Capacity-slot resolution composes those calendars with bounded reservations.

Effects receive already resolved timestamps/durations. Effects must not implement MRP/scheduling/calendar decisions or convenience wall-clock calculations such as `now + N days` when the value can be resolved before mutation.

## 4. Original admitted Effect inventory and classification

Classification:

- **A KEEP** — true generic primitive identity is acceptable.
- **B NORMALIZE** — generic capability exists but public primitive identity or contract must be normalized.
- **C DEMOTE** — business/integration/reasoning semantic belongs outside primitive Object_Effect identity.
- **D COMPATIBILITY ALIAS** — historical name only; must not remain canonical authority.
- **E REMOVE** — duplicate/obsolete/invalid primitive.

| Existing code | Class | Audit result |
|---|---|---|
| `CHILD_SERVICE_OBJECT_CREATE` | B | Normalize to `SERVICE_OBJECT_CREATE`; canonical primitive creates one governed Service Object. Multi-child decomposition and link orchestration belong in Macro composition. |
| `STATUS_SET` | B | Overloaded target. Split canonical identity into `SERVICE_OBJECT_STATE_TRANSITION` and `TASK_STATE_TRANSITION`. |
| `SO_UPDATE` | D | Historical executable identity. Canonical public primitive is `SERVICE_OBJECT_PATCH`. |
| `TASK_CREATE` | B | Primitive concept valid; due time must arrive already resolved as `due_at`. |
| `TASK_UPDATE` | B/D | Overloaded patch + state transition. Normalize to `TASK_PATCH` and `TASK_STATE_TRANSITION`. |
| `LINK_CREATE` | A | Generic bounded relation creation primitive. |
| `LINK_REMOVE` | A | Generic bounded relation removal primitive. |
| `JSON_MERGE` | E | Broad multi-target mutation duplicates object-family patch semantics and hides object boundaries. Retire. |
| `HTTP_REQUEST` | C | Domain-neutral integration capability, but not an Object_Effect mutation. Remove from Effect dispatch; integration results are persisted through Object_Effects. |
| `INFO_RECORD_WRITE` | B | Normalize to `INFO_RECORD_CREATE`. |
| `ACCESS_GRANT_CREATE` | A | Explicit security-kernel Effect. |
| `ACCESS_GRANT_UPDATE` | B | Normalize to `ACCESS_GRANT_PATCH`. |
| `INSTANCE_START` | B | Normalize to `PROCESS_START`. |
| `INVENTORY_MOVE` | C | Business semantic. Demote to Macro reasoning + primitive mutations. |
| `INVENTORY_CONSUME` | C | Business semantic. Demote to Macro reasoning + primitive mutations. |
| `INVENTORY_PRODUCE` | C | Business semantic. Demote to Macro reasoning + primitive mutations. |
| `INVENTORY_CONVERT` | C | Business semantic and composition of consume + produce. Demote to Macro composition. |
| `VARIANT_INVENTORY_VALIDATE` | C | Business validation/reasoning mixed with mutation. Move calculation/decision to governed reasoning. |
| `SO_CREATE` | D | Historical alias only. Replacement: `SERVICE_OBJECT_CREATE`. |
| `SO_STATUS` | D | Historical alias only. Replacement: `SERVICE_OBJECT_STATE_TRANSITION`. |
| `TASK_STATUS` | D | Historical alias only. Replacement: `TASK_STATE_TRANSITION`. |
| `LINK` | D | Historical alias only. Replacement: `LINK_CREATE`. |
| `ATTRS_MERGE` | E | Historical alias to retired broad `JSON_MERGE`; remove/deactivate. |
| `API_CALL` | D/C | Historical alias to integration capability; not Object_Effect authority. |

Cross-domain simulation identified one missing primitive rather than a business Effect: `LINK_PATCH`. It is admitted because mutable relationship metadata is a domain-neutral kernel mutation needed without deleting and recreating link identity.

## 5. Canonical Object_Effect Primitive V1 vocabulary — LOCKED

```text
SERVICE_OBJECT_CREATE
SERVICE_OBJECT_PATCH
SERVICE_OBJECT_STATE_TRANSITION

TASK_CREATE
TASK_PATCH
TASK_STATE_TRANSITION

LINK_CREATE
LINK_PATCH
LINK_REMOVE

INFO_RECORD_CREATE
PROCESS_START
```

Separate security-kernel primitives:

```text
ACCESS_GRANT_CREATE
ACCESS_GRANT_PATCH
```

`HTTP_REQUEST` is not part of Object_Effect Primitive V1. Generic integration capability may exist outside Effect dispatch; returned integration data is consumed by Macro reasoning/context and persisted through an admitted Object_Effect.

No `MATERIAL_LOT_*` primitive is admitted merely to replace `INVENTORY_*`. A new kernel-family primitive is introduced only when a real active use case cannot be represented safely with the current kernel/Service Object model and passes the primitive admission test.

## 6. Canonical primitive contracts

### SERVICE_OBJECT_CREATE

Purpose: create one governed Service Object.

- explicit tenant context from authenticated/server context;
- governed object type/category/status;
- bounded initial fields/attrs;
- no multi-child orchestration;
- no implicit links; use `LINK_CREATE` separately.

### SERVICE_OBJECT_PATCH

Purpose: bounded mutation of non-lifecycle fields on one existing Service Object.

Canonical allowed mutation scope:

```text
service_object.code
service_object.title
service_object.owner_agent_id
service_object.attrs (through bounded SET/REMOVE JSON path patches)
```

Rules:

- explicit Service Object identity from governed context/runtime parameter;
- `owner_agent_id`, when non-null, must resolve to an active same-tenant Agent;
- attrs are mutated only through bounded path patches, not free-form top-level JSON merge;
- calculated values may arrive through Macro context such as `$calc.*`;
- no arithmetic/reasoning in the handler;
- `status` is forbidden here and belongs to `SERVICE_OBJECT_STATE_TRANSITION`;
- `object_type` is not patchable through this primitive;
- no arbitrary table/column target.

### SERVICE_OBJECT_STATE_TRANSITION

Purpose: atomic governed Service Object lifecycle state transition.

May validate/lock/update state and write mandatory state history because these operations implement one indivisible lifecycle invariant.

### TASK_CREATE

Purpose: create one durable governed Task when work-management persistence is required.

Receives resolved values such as `due_at`; it must not calculate calendar policy or working-time dates.

### TASK_PATCH

Purpose: bounded mutation of non-lifecycle Task fields.

Task status/lifecycle belongs to `TASK_STATE_TRANSITION`.

### TASK_STATE_TRANSITION

Purpose: atomic governed Task lifecycle state transition plus mandatory history.

### LINK_CREATE

Purpose: create one governed kernel relationship with bounded initial relationship metadata.

### LINK_PATCH

Purpose: bounded mutation of metadata on one existing governed kernel relationship without replacing relationship identity.

Identity is supplied by the full governed link key:

```text
src_kind
src_id
dst_kind
dst_id
relation_type
```

Only `object_link.attrs` may be changed, using bounded `SET` / `REMOVE` path operations. `src_kind`, `src_id`, `dst_kind`, `dst_id`, and `relation_type` are selectors, not patchable fields.

Typical cross-domain uses include allocation quantities/effective dates, hospital bed-assignment metadata, production resource-allocation metadata, collaboration metadata, and other relationship facts. Their business meaning remains metadata/Macro semantics, not handler semantics.

### LINK_REMOVE

Purpose: remove one governed kernel relationship by explicit identity.

### INFO_RECORD_CREATE

Purpose: create one governed Info Record. Relationship creation remains explicit via `LINK_CREATE` unless an indivisible kernel invariant requires otherwise.

### PROCESS_START

Purpose: start/reuse a governed Process Instance for an explicit Service Object under the existing Process definition/binding rules.

### ACCESS_GRANT_CREATE / ACCESS_GRANT_PATCH

Security-kernel primitives, separate from business Object_Effect semantics. Their admission does not authorize business-specific grant types in handler code.

## 7. Explicitly rejected primitive names

The following are rejected as canonical Effect primitives:

```text
INVENTORY_MOVE
INVENTORY_CONSUME
INVENTORY_PRODUCE
INVENTORY_CONVERT
VARIANT_INVENTORY_VALIDATE
MRP_RUN
SCHEDULE_PRODUCTION
RELEASE_WORK_ORDER
APPROVE_PURCHASE
APPROVE_ALTERNATIVE_SUPPLIER
RECEIVE_MATERIAL
ALLOCATE_MACHINE
SELECT_TRUCK
DISPATCH_FLEET
REPLENISH_STORE
ORDER_CONFIRM
ASSIGN_HOSPITAL_BED
TRANSFER_PATIENT
BARCODE_SCAN
SCAN_PROCESS
```

They are Process/Macro/reasoning/resolver semantics.

## 8. Cross-domain freeze simulations

Primitive V1 was re-tested conceptually against materially unrelated workflows before freeze.

### MRP / material planning

```text
Demand/BOM/supply facts
  -> governed arithmetic + calendar/resource resolution
  -> calculated requirements, shortages and dates
  -> SERVICE_OBJECT_CREATE / SERVICE_OBJECT_PATCH
  -> LINK_CREATE / LINK_PATCH for allocations/relationship facts
  -> state/process primitives as required
```

No inventory/MRP primitive is required.

### Hospital appointment and inpatient handling

```text
Patient/clinical/resource requirements
  -> calendar + capacity resolver
  -> appointment/admission Service Object facts
  -> LINK_CREATE / LINK_PATCH for doctor/room/bed relationships
  -> SERVICE_OBJECT_PATCH / STATE_TRANSITION
  -> TASK/INFO_RECORD primitives as required
```

No appointment/bed/patient-transfer Effect is required.

### Production-floor orchestration

```text
Route/process semantics
  -> work requirement + resource + calendar/capacity resolution
  -> planned/actual facts
  -> SERVICE_OBJECT_PATCH
  -> LINK_CREATE / LINK_PATCH for resource assignments
  -> TASK and state primitives
```

No machine-allocation or production-line Effect is required.

### Physical/process scanning

Scan/barcode/identifier lookup is an input/resolver capability. The validated business event is persisted through `INFO_RECORD_CREATE`, `SERVICE_OBJECT_PATCH`, `TASK_STATE_TRANSITION`, links or other admitted primitives as appropriate. No scan-specific Effect is required.

Result: the same primitive set covers materially unrelated domains without changing handler identity. This cross-domain reuse is the basis for the Primitive V1 freeze.

## 9. Inventory decomposition rule

```text
INVENTORY_CONSUME business intent
  -> Macro reasoning: validate quantities, calculate next values/state
  -> primitive patch/state/link effects on the governed object model actually used
  -> optional INFO_RECORD_CREATE if the Process requires evidence
```

```text
INVENTORY_CONVERT business intent
  -> Macro reasoning: conversion ratios/input/output quantities
  -> required primitive create/patch/state/link effects
```

The Effect Library must not regain inventory verbs merely because inventory workflows are common.

## 10. Calendar/MRP/scheduling interaction

Planning, MRP and scheduling are not Effects.

```text
Process/Macro
  -> reasoning + calendar/capacity resolvers
  -> calculated plan/schedule in transient governed context
  -> SERVICE_OBJECT_PATCH (or another admitted object-family primitive)
  -> persist planned timestamps/quantities/state projections
```

The temporal gate consumes persisted schedule facts and does not calculate them.

## 11. Alias policy

Aliases are transitional only.

- one public canonical primitive identity;
- aliases may not carry a broader parameter contract than the canonical primitive indefinitely;
- aliases may not encode separate business meaning;
- aliases are hidden/deprecated in governed metadata;
- removal occurs after active Process definitions have been migrated;
- runtime must fail closed when an inactive/unknown alias is requested.

## 12. Concurrency and idempotency boundary

Cross-domain simulations also confirm that allocation races, duplicate scans or double-start attempts are not reasons to add business Effects. Atomic transactions, row locks/preconditions, idempotency keys and other generic concurrency controls belong to runtime/kernel guarantees around the primitive operation.

## 13. Expansion gate after freeze

`v2_0038` marks active `PROCESS_EFFECT_TYPE` catalogues as Primitive V1 locked/frozen.

Adding a canonical Effect after this point requires:

1. explicit primitive-admission review against all ten rules;
2. proof that existing primitives cannot cleanly express the requirement;
3. explicit kernel-object family;
4. bounded parameter contract;
5. finite reviewed handler;
6. governed metadata entry;
7. cross-domain reuse tests;
8. unknown/unsupported-parameter fail-closed tests;
9. Process/Macro separation review;
10. documentation update and a new forward migration.

Business growth must normally expand Process/Macro metadata, not the primitive library.
