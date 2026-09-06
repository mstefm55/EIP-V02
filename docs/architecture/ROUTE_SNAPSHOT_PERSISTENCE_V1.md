# EIP Route Snapshot Persistence V1

Date: 2026-08-31

Status: Wave 3 implementation contract under `OPERATING_MODEL_CANON.md`, `EXECUTION_AND_ROUTE_CANON.md`, and `ORCHESTRATION_V1.md`.

## 1. Purpose

The in-memory route planner/coordinator/lifecycle runtime is now proven. This slice makes the current route snapshot durable without introducing a new route table.

The V1 persistence choice is a bounded reserved runtime projection inside the owning Service Object JSONB attributes:

```text
service_object.attrs
  -> _eip_runtime
       -> process_route_v1
```

This is an implementation choice for the current wave, not a permanent declaration that route state must always live in JSONB.

If measured query frequency, write amplification, lifecycle integrity or reporting requirements later justify a relational route structure, that becomes a schema-admission proposal requiring owner approval. No automatic promotion is authorized.

## 2. Why the Service Object owns the snapshot

A multi-process route belongs to the lifecycle of one Service Object and exists before, between and after individual Process Instances.

Therefore it should not be stored only inside one child Process Instance.

The route is resolved at the governed route-initialization trigger, then the saved version-pinned snapshot becomes the orchestration authority for that Service Object. The orchestrator progresses this saved route; it does not rediscover a new route after every step.

The V1 route snapshot contains only bounded orchestration state and provenance:

```text
route version
route source/provenance
ordered process-definition snapshot
route-step state
bound process_instance_id per active/completed step
bounded temporal/orchestration eligibility metadata where approved
```

Business payloads and arbitrary calculation results do not belong inside this runtime route snapshot.

## 3. Query-shape rule

The persistence adapter must never fetch the full Service Object `attrs` merely to read the route.

Read shape:

```sql
SELECT attrs #> <governed route path>
FROM eip_core.service_object
WHERE tenant_id=? AND id=?
```

Lifecycle ticks read with `FOR UPDATE` so concurrent ticks for the same Service Object serialize on that row while the caller's transaction is active.

Writes update only the reserved `_eip_runtime` namespace while preserving unrelated Service Object attributes.

## 4. Reserved runtime namespace

`_eip_runtime` is reserved for bounded internal runtime projections. Tenant-authored UI/business metadata must not treat this namespace as free-form application storage.

For this wave only the following key is introduced:

```text
_eip_runtime.process_route_v1
```

No other runtime subsystem is authorized by this document to create arbitrary keys under `_eip_runtime` without its own governed contract.

## 5. Bounds

Persistence fails closed when:

- tenant or Service Object identity is missing;
- route snapshot is missing or malformed;
- route version is not supported;
- route step count exceeds the bounded V1 maximum;
- serialized snapshot exceeds the configured maximum size;
- initialization attempts to overwrite an existing route without explicit replacement authorization;
- the owning Service Object does not exist.

The default serialized route-snapshot ceiling is 128 KiB with an implementation hard cap of 1 MiB. This is a safety boundary, not a target size.

## 6. Atomic lifecycle tick

The intended transaction-level operation is:

```text
BEGIN
  -> SELECT route projection FROM service_object FOR UPDATE
  -> run lifecycle coordinator
  -> observe current Process Instance
  -> if completed, mark saved route step COMPLETED
  -> determine next route-step temporal/resource eligibility
  -> start/reuse next Process Instance only when eligible
  -> otherwise persist a waiting route state
  -> persist resulting route snapshot
COMMIT
```

The persistence helper assumes the supplied database client participates in the caller's transaction. It does not open nested transactions.

This preserves the boundary:

```text
Process Engine        = one Process Instance
Route Coordinator     = sequencing between saved route steps
Temporal resolver     = whether/when the next step may start
Persistence Adapter   = durable route snapshot
```

Completion of one Process Instance is not, by itself, permission to start the next Process Instance immediately.

## 7. Route immutability and migration

Publishing a new route does not rewrite already-pinned Service Object routes.

```text
new Service Object
  -> current route resolution

in-progress Service Object
  -> remains on existing saved route by default
  -> may move only through explicit governed route migration

completed Service Object
  -> completed route is immutable historical record
  -> never migrated
```

Route migration is a separate governed operation. It must preserve old/new route provenance and completed-step history, and must not silently replace a completed route or erase already-executed work.

The persistence adapter's `replaceExisting` mechanism is a low-level implementation control and must not be treated as authorization for arbitrary business route migration. Higher-level route migration governance must decide whether replacement is allowed and how history/mapping is preserved.

## 8. No schema expansion

This slice adds:

```text
new tables      0
new migrations  0
new Effects     0
```

If this JSONB projection later proves operationally inadequate, evidence must include query shape, update frequency, route size, index requirements, lock/contention behavior and representative query plans before proposing relational promotion.
