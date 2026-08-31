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
  -> recalculate current eligibility from pinned policy + current schedule facts
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
  = current scheduler decision + temporal gate + existing calendar/temporal resolver

HOW
  = Process Engine -> Macro -> Effects
```

The temporal gate must not contain branches such as `if sales order`, `if production`, `if hospital`, or similar domain semantics.

## 3. Pinned timing policy versus dynamic schedule

The saved route may contain stable timing policy, but derived scheduling results are not frozen route truth.

A route step may carry bounded policy metadata in its existing `attrs`:

```json
{
  "temporal_v1": {
    "not_before_at": "2026-09-01T08:00:00.000Z",
    "calendar_code": "SITE_DEFAULT"
  }
}
```

Supported V1 policy fields are generic:

```text
not_before_at
  policy-level absolute earliest start instant

delay_after_previous_minutes
  elapsed-minute delay after the previous completed route step

working_delay_after_previous_minutes
  working-minute delay after the previous completed route step;
  requires calendar_code

calendar_code
  governed calendar projection identifier; when present, a step may start only at a working instant
```

`delay_after_previous_minutes` and `working_delay_after_previous_minutes` are mutually exclusive in V1.

By contrast, values such as the currently calculated feasible instant or allocated/planned start may change while a step remains PENDING. They are supplied at runtime through a bounded schedule projection keyed by route step, conceptually:

```json
{
  "STEP_CODE": {
    "eligible_at": "2026-09-02T10:00:00.000Z",
    "planned_start_at": "2026-09-02T13:00:00.000Z",
    "source_code": "CURRENT_SCHEDULE",
    "revision": "42"
  }
}
```

The runtime treats `source_code` as opaque provenance. It does not understand material, manufacturing, healthcare, fleet or other business meanings.

## 4. Dynamic recalculation rule

A PENDING route step is re-evaluated against the current schedule projection whenever orchestration ticks it.

A previous `WAIT_TIME.eligible_at` is therefore an observation of the schedule at that moment, not an immutable promise written into route history.

Conceptually:

```text
tick 1
  current schedule says 14:00
  -> WAIT_TIME 14:00

dynamic conditions change
  -> governed scheduler recomputes

tick 2
  current schedule says 11:00
  -> eligibility is recalculated from 11:00
```

The reverse is also valid: a previously early planned start may move later when current constraints require it.

This does not require route migration because the Process sequence/version has not changed. Route migration is for changing the pinned execution route. Replanning changes `WHEN`, not `WHAT NEXT`.

## 5. Cross-object reprioritization

Reordering two different Service Objects because capacity, material availability, urgency, resource availability or another governed condition changed is a scheduler/work-allocation decision across candidate work.

Example only:

```text
Object A was planned first
Object B was planned later
current governed facts change
scheduler recalculates
Object B receives the earlier feasible slot
Object A receives the later slot
```

The route runtime must not contain a special `material late`, `swap production orders`, `patient priority`, `vehicle priority`, or similar domain branch.

The generic boundary is:

```text
current governed facts + pending work + resources/capacity + policy
  -> scheduler/work-allocation resolution
  -> current per-step schedule projection
  -> temporal gate
  -> Process start when eligible
```

The current V1 temporal gate consumes the resolved schedule projection. It does not implement a cross-object optimization engine inside the route coordinator.

## 6. Calendar resolution

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

## 7. Eligibility calculation

The gate recalculates the earliest applicable constraint from the current inputs:

```text
pinned policy not_before_at
previous-step completion + elapsed delay
previous-step completion + working-time delay
current dynamic eligible_at
current dynamic planned_start_at
current working-calendar availability
```

When several constraints apply, the latest effective start constraint wins.

If the step is not yet eligible:

```text
state stays PENDING
action = WAIT_TIME
```

The coordinator does not transition the step to ACTIVE until the temporal gate allows start.

If no static temporal policy and no dynamic schedule projection exists, behavior remains backward compatible and the step may start immediately.

## 8. Completion timestamp

When a bound Process Instance reaches `completed`, its `ended_at` becomes the route step's bounded `completed_at` orchestration timestamp.

This timestamp is not a replacement for Process Instance history. It exists so later route steps can resolve generic dependency timing without re-querying or rewriting historical Process Instances.

A completed Process Instance without a completion timestamp is treated as inconsistent and fails closed in this V1 integration.

## 9. WAIT_TIME action

A non-eligible step returns a bounded action such as:

```json
{
  "type": "WAIT_TIME",
  "service_object_id": "...",
  "step_code": "PLAN",
  "eligible_at": "2026-09-01T08:00:00.000Z",
  "reason": "PLANNED_START"
}
```

`WAIT_TIME` is orchestration output, not a new persisted route state. The route step remains `PENDING`.

Because the schedule is dynamic, the next tick may return a different `eligible_at` without changing the route definition or migrating the Service Object.

## 10. Capacity and scheduling boundary

This V1 gate is not a full optimization scheduler.

Existing capacity/workstation/calendar primitives can contribute to a feasible current schedule. A future generic scheduling/work-allocation resolver may compare multiple pending Service Objects and update their current schedule projections.

Do not duplicate workstation selection, reservation search, candidate ranking, forward/backward planning, or optimization logic inside the route coordinator.

Thus:

```text
scheduler/work allocation
  -> current feasible/resolved timing
  -> route temporal gate
  -> start when eligible
```

## 11. Route migration compatibility

Stable route policy is part of the saved in-flight route projection. Publishing changed route policy does not silently rewrite an existing route.

Dynamic schedule recalculation is different: changing a pending step's current planned/eligible time does not by itself require route migration because the pinned route sequence and Process Definitions remain unchanged.

An in-progress route requires explicit governed route migration only when the pinned route itself changes. A completed route remains immutable historical record.

## 12. No architecture expansion

This slice adds:

```text
new tables               0
new migrations           0
new Effects              0
new reasoning operators  0
new domain schedulers    0
```

It composes the existing route snapshot/runtime and Wave 2 calendar primitives while leaving cross-object scheduling as a generic bounded scheduler/work-allocation responsibility.
