# EIP Route Temporal Gate V1

Date: 2026-08-31

Status: Wave 3 implementation contract under `EXECUTION_AND_ROUTE_CANON.md`, `TEMPORAL_RESOURCE_V1.md`, and the existing route runtime contracts.

## 1. Purpose

A completed route step does not automatically authorize immediate start of the next Process Instance.

This slice inserts a generic temporal eligibility gate between route progression and Process Instance start. It composes the existing calendar/working-time resolver rather than creating a domain scheduler or hardcoding business operations.

Plain-English flow:

```text
current route step completes
  -> mark that saved step COMPLETED
  -> inspect next saved PENDING step
  -> determine earliest time it may start
  -> apply governed working calendar when referenced
  -> start now if eligible
     OR keep the step PENDING and return WAIT_TIME
```

The route remains the Service Object's saved execution plan. The gate answers only `WHEN`, not business `WHAT`.

## 2. Responsibility boundary

```text
WHAT
  = Process Definition / governed metadata

WHAT NEXT
  = saved route snapshot

WHEN
  = temporal gate + existing calendar/temporal resolver

HOW
  = Process Engine -> Macro -> Effects
```

The temporal gate must not contain branches such as `if sales order`, `if production`, `if hospital`, or similar domain semantics.

## 3. Route-step temporal policy

A route step may carry bounded resolved temporal metadata in its existing `attrs`:

```json
{
  "temporal_v1": {
    "not_before_at": "2026-09-01T08:00:00.000Z",
    "calendar_code": "SITE_DEFAULT"
  }
}
```

Supported V1 fields are generic:

```text
not_before_at
  absolute earliest start instant

delay_after_previous_minutes
  elapsed-minute delay after the previous completed route step

working_delay_after_previous_minutes
  working-minute delay after the previous completed route step;
  requires calendar_code

calendar_code
  governed calendar projection identifier; when present, a step may start only at a working instant
```

`delay_after_previous_minutes` and `working_delay_after_previous_minutes` are mutually exclusive in V1.

The route initializer may snapshot static route temporal metadata from the binding or accept an already-resolved per-binding temporal map from an upstream governed scheduler/resolver. This does not authorize arbitrary executable timing code in metadata.

## 4. Calendar resolution

Wave 2 deliberately did not create a calendar persistence table. Therefore this gate consumes calendar layers as already-resolved governed projections keyed by `calendar_code`.

Conceptually:

```text
route step calendar_code
  -> governed calendar projection supplied by caller/runtime integration
  -> existing calendarResolver
  -> working-time eligibility
```

If a referenced calendar cannot be resolved, the gate fails closed.

This preserves the future ability to resolve calendar layers from tenant/site/workstation/resource metadata without duplicating those rules inside route code.

## 5. Eligibility calculation

The gate computes the earliest applicable constraint from:

```text
explicit not_before_at
previous-step completion + elapsed delay
previous-step completion + working-time delay
current working-calendar availability
```

When several constraints apply, the latest effective start constraint wins.

If the step is not yet eligible:

```text
state stays PENDING
action = WAIT_TIME
```

The coordinator does not transition the step to ACTIVE until the temporal gate allows start.

If no temporal policy exists, behavior remains backward compatible and the step may start immediately.

## 6. Completion timestamp

When a bound Process Instance reaches `completed`, its `ended_at` becomes the route step's bounded `completed_at` orchestration timestamp.

This timestamp is not a replacement for Process Instance history. It exists so later route steps can resolve generic dependency timing without re-querying or rewriting historical Process Instances.

A completed Process Instance without a completion timestamp is treated as inconsistent and fails closed in this V1 integration.

## 7. WAIT_TIME action

A non-eligible step returns a bounded action such as:

```json
{
  "type": "WAIT_TIME",
  "service_object_id": "...",
  "step_code": "PLAN",
  "eligible_at": "2026-09-01T08:00:00.000Z",
  "reason": "NOT_BEFORE"
}
```

`WAIT_TIME` is orchestration output, not a new persisted route state. The route step remains `PENDING`.

## 8. Capacity and scheduling boundary

This V1 gate is not a full optimization scheduler.

Existing capacity/workstation resolvers may calculate a feasible planned start. That result can be materialized as a resolved `not_before_at` or supplied through the future scheduler integration.

Do not duplicate workstation selection, reservation search, forward/backward planning, or optimization logic inside the route coordinator.

Thus:

```text
capacity/resource scheduler
  -> feasible/resolved timing
  -> route temporal gate
  -> start when eligible
```

## 9. Route migration compatibility

Temporal policy is part of the saved in-flight route projection. Publishing changed temporal metadata does not silently rewrite an existing route.

An in-progress route may adopt changed route/timing policy only through an explicit governed route migration. A completed route remains immutable historical record.

## 10. No architecture expansion

This slice adds:

```text
new tables               0
new migrations           0
new Effects              0
new reasoning operators  0
new domain schedulers    0
```

It composes the existing route snapshot/runtime and Wave 2 calendar primitives.
