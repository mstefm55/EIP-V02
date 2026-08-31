# EIP Route Snapshot Persistence V1

Date: 2026-08-31

Status: Wave 3 implementation contract under `OPERATING_MODEL_CANON.md` and `ORCHESTRATION_V1.md`.

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

The V1 route snapshot contains only bounded orchestration state and provenance:

```text
route version
route source/provenance
ordered process-definition snapshot
route-step state
bound process_instance_id per active/completed step
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
  -> observe/start/reuse Process Instance as needed
  -> persist resulting route snapshot
COMMIT
```

The persistence helper assumes the supplied database client participates in the caller's transaction. It does not open nested transactions.

This preserves the boundary:

```text
Process Engine       = one Process Instance
Route Coordinator    = sequencing between Process Instances
Persistence Adapter  = durable route snapshot
```

## 7. No schema expansion

This slice adds:

```text
new tables      0
new migrations  0
new Effects     0
```

If this JSONB projection later proves operationally inadequate, evidence must include query shape, update frequency, route size, index requirements, lock/contention behavior and representative query plans before proposing relational promotion.
