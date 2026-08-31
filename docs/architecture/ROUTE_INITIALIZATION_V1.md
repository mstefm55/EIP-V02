# EIP Route Initialization V1

Date: 2026-08-31

Status: Wave 3 implementation contract under `OPERATING_MODEL_CANON.md`, `ORCHESTRATION_V1.md`, and `ROUTE_SNAPSHOT_PERSISTENCE_V1.md`.

## 1. Purpose

The route planner, coordinator, lifecycle runtime and persistence adapter are already proven independently. This slice adds the missing front of the orchestration chain: determine the bounded candidate Process Definitions for a Service Object, convert already-governed applicability/order metadata into a version-pinned route snapshot, persist it, then start the first Process Instance through the existing route runtime.

Plain-English flow:

```text
business object
  -> find the processes linked to this type of object
  -> keep only the processes that apply to this case
  -> put them in an explicitly governed order
  -> save that process plan
  -> start the first process
```

Canonical flow:

```text
SERVICE OBJECT
  -> bounded PROCESS BINDING candidates
  -> externally/governedly resolved applicability
  -> ROUTE PLANNER
  -> version-pinned route snapshot
  -> durable route persistence
  -> existing route lifecycle runtime
  -> first PROCESS INSTANCE
```

## 2. Process Binding remains an applicability mapping

`process_binding` is not promoted into a second workflow engine.

The resolver uses its indexed relational fields only to discover a bounded candidate set:

```text
tenant_id
service_object_type
optional task_type
is_active
process_def_id
priority
```

A binding may carry a small declarative `attrs.route_v1` hint used only to shape one route entry:

```json
{
  "route_v1": {
    "step_code": "PLAN",
    "sequence": 200,
    "enabled": true,
    "required": true
  }
}
```

This metadata must not contain transitions, arbitrary executable conditions, JavaScript, SQL, Macro logic or Effect logic. Process execution remains inside Process Definitions and the Process Engine.

`priority` is not silently reinterpreted as route sequence. It remains binding-selection/candidate-order metadata. Multi-step routes require explicit route sequence metadata so EIP does not guess business lifecycle order.

## 3. Applicability stays outside the route planner

Per-case applicability may eventually be calculated by governed reasoning, Profile Pack policy, or another governed resolver.

Route Initialization V1 consumes the result as plain resolved booleans keyed by binding identity. It does not invent another condition language.

Conceptually:

```text
candidate binding
  -> governed applicability result true/false
  -> route entry applicable true/false
  -> route planner filters non-applicable entries
```

When no per-case applicability result is supplied, the candidate is treated as applicable unless its static `route_v1.enabled` metadata is false.

## 4. Ordering rule

For one applicable candidate, sequence may default to `100`.

For more than one applicable candidate, every included candidate must provide an explicit finite `route_v1.sequence`. Route initialization fails closed if ordering is ambiguous.

The resolver must never infer lifecycle order merely from:

- database row order;
- Process Definition creation time;
- Process Definition version;
- binding priority;
- process name/code alphabetical order.

Those may be used only for deterministic candidate-query ordering, not business route semantics.

## 5. Version pinning and provenance

Every resulting route step snapshots:

- stable `step_code`;
- explicit `process_def_id`;
- Process Definition code;
- Process Definition version;
- sequence;
- binding identity as bounded provenance;
- optional task-type/priority provenance.

The route then uses the existing pinned `process_def_id` when starting the Process Instance. Later metadata/profile changes do not silently rewrite an in-flight route.

## 6. Candidate query and bounds

The candidate query must stay bounded and persistence-side filtered.

Required predicates:

```text
tenant_id = ?
service_object_type = ?
process_binding.is_active = true
process_def.is_active = true
```

When no task type is requested, V1 uses general bindings (`task_type IS NULL`). When a task type is supplied, exact task-type bindings and general bindings may both be considered.

The resolver queries at most `maxCandidates + 1` rows so it can detect overflow and fail closed instead of loading an unbounded tenant set into application memory.

Default candidate limit: 64.
Hard limit: 256.

## 7. Initialization transaction

The intended caller transaction is:

```text
BEGIN
  -> lock/read current route projection
  -> reject if a route already exists unless explicit replacement is authorized
  -> read Service Object type
  -> read bounded candidate bindings + pinned Process Definitions
  -> apply already-resolved applicability
  -> build ordered route snapshot
  -> persist route snapshot
  -> run persisted route lifecycle tick
  -> start/reuse first Process Instance
  -> persist ACTIVE/bound route state
COMMIT
```

The helpers use the supplied database client and do not open nested transactions.

## 8. Fail-closed conditions

Initialization fails closed when:

- tenant or Service Object identity is missing;
- Service Object does not exist;
- route already exists and replacement was not explicitly authorized;
- no applicable candidate Process Definition exists;
- candidate count exceeds the configured bound;
- a multi-step route has missing/non-finite sequence metadata;
- step codes collide;
- an applicability result is not boolean;
- route snapshot persistence validation fails;
- first Process Instance cannot be started/reused.

## 9. No schema or engine expansion

This slice adds:

```text
new tables      0
new migrations  0
new Effects     0
new reasoning operators 0
Process Engine internal changes 0
```

It composes existing governed structures rather than introducing a route table or a second workflow engine.
