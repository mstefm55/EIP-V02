# EIP Execution and Route Canon

Date: 2026-09-01

Status: Canonical architecture guardrail approved for EIP Core V2 operating-model development.

This document clarifies the responsibility split between governed business semantics, routing, reasoning, process execution, Effects, persistence, planning/scheduling, time, resources and audit. It must be read with `OPERATING_MODEL_CANON.md`, `TASK_EFFECT_MODEL.md`, `TEMPORAL_RESOURCE_V1.md`, and the Wave 3 orchestration contracts.

Security and authentication remain outside the current modelling wave.

---

## 1. Core responsibility model

EIP must not hardcode the business `what` in runtime code.

The canonical responsibility split is:

```text
WHAT
  = governed Process Definitions, task labels/semantics, Profile Pack and tenant metadata

WHETHER / WHICH
  = governed reasoning, applicability and bounded policy resolution

WHAT NEXT
  = the Service Object's version-pinned route snapshot

HOW
  = Process Engine resolving a Process step/transition into a governed Macro whose reasoning feeds ordered Effects

WHERE
  = the appropriate kernel persistence structures: relational tables and governed JSONB according to lifecycle, integrity and query requirements

WHEN
  = governed Planning/Scheduling process logic using calendars, dependencies, working time, capacity, resources and scheduling policy; the accepted result is persisted on the route and later enforced by route maturity checks

WHO / WITH WHAT
  = governed agents, workstations/resources, capabilities and assignments

WHY
  = process history, reasoning/provenance audit, route provenance and decision source
```

These are responsibility boundaries, not separate domain engines.

---

## 2. `HOW` refinement: Process Engine, Macro and Effects

The Effect Library does not decide business workflow and the Process Engine does not contain hardcoded domain operations.

The canonical execution chain is:

```text
PROCESS
  -> STEP / TASK SEMANTICS
  -> MACRO
       -> governed reasoning / calculation / decision resolution as needed
       -> ordered OBJECT_EFFECTS
  -> OUTPUT / resulting state
  -> next transition / next step
```

The Process Engine orchestrates a Process Instance and resolves the governed Macro for the current transition/step intent.

A Macro is the governed execution bundle for that process step/transition. It may calculate/resolve values and then use those calculated values as parameters for one or more Effects.

Effects are the governed mutation boundary. They create, patch, transition, link or otherwise transform explicit kernel object families.

Therefore the normal repeating Process Engine model is:

```text
INPUT
  -> PROCESS STEP / TRANSITION
  -> MACRO
       -> logic / calculation / decisions
       -> Effects
  -> OUTPUT
  -> NEXT STEP
  -> repeat
```

Logic/decision resolution is not a separate workflow engine. Macro reasoning produces the values and decisions needed by the Macro's Effects and by the Process transition.

---

## 3. `WHERE` refinement: not every fact becomes a new table

`WHERE` means the governed persistence model, not simply "put everything in tables".

Use relational structures where identity, foreign-key integrity, lifecycle, high-frequency query shape or other proven requirements justify them.

Use governed JSONB for bounded extensibility and runtime projections where appropriate.

Do not automatically promote a JSONB field into a column/table for convenience or performance speculation. Existing schema-admission and owner-approval rules remain binding.

The current V1 route snapshot is stored under:

```text
service_object.attrs._eip_runtime.process_route_v1
```

The saved route contains both pinned route identity/provenance and bounded mutable runtime projection such as route-step state and current schedule. This remains a V1 implementation choice, not a permanent declaration that route persistence can never become relational.

---

## 4. `WHEN` refinement: Planning/Scheduling calculates; route orchestration enforces

A calendar answers questions such as:

- is this instant working time?;
- what is the next/previous working instant?;
- how much working time exists between two instants?;
- what working intervals are available after exceptions/overrides?

Capacity/resource functions answer bounded questions about capable resources, required work and feasible slots.

These are calculation tools. They do not own workflow.

Scheduling is a governed subprocess of Planning. It normally runs according to the Planning cycle, but the same Scheduling process may also be triggered by an exception/emergency that requires replanning.

Conceptually:

```text
NORMAL PLANNING CYCLE                  EXCEPTION / EMERGENCY
        |                                      |
        +------------------+-------------------+
                           |
                           v
                 SCHEDULING PROCESS
                           |
                    STEP / TASK
                           |
                         MACRO
                    +------+------+
                    |             |
              reasoning       Effects
              calendar        patch accepted
              capacity        schedule into
              resources       route JSONB
              policy
                    |             |
                    +------+------+ 
                           |
                           v
                 persisted route schedule
```

The Scheduling Macro may compose the existing reasoning, calendar, work-requirement, capacity-slot and workstation/resource functions. A bounded generic optimization/solver capability is admitted only if ordinary composition is genuinely insufficient under the Generic Capability Admission Rule.

The route orchestrator does **not** recalculate the schedule. It reads the current persisted schedule and enforces whether the next route process is mature for start.

Therefore:

```text
Calendar / capacity / resource functions
  = governed calculation inputs

Planning/Scheduling Process + Macro
  = calculate/recalculate WHEN

Effects
  = persist accepted schedule/result

Route Orchestrator
  = consume/enforce the persisted WHEN
```

### 4.1 Dynamic scheduling is not route migration

The route defines `WHAT NEXT`; the current schedule defines `WHEN`.

A Service Object may remain pinned to the same route while the schedule for its pending steps changes many times before execution.

Conceptually:

```text
pinned route
  Validate -> Plan -> Execute -> Finish

schedule revision 41
  Execute planned 14:00

current conditions change
Planning/Scheduling is triggered again

schedule revision 42
  Execute planned 11:00
```

The new schedule is persisted back into the existing route projection through governed Effect execution. The Route Orchestrator consumes the latest persisted approved schedule on its next tick.

That is replanning, not rerouting.

Cross-object reprioritization is likewise a Planning/Scheduling concern. The route runtime must not contain business-specific reasons such as material delay, production order swap, patient urgency or vehicle priority.

---

## 5. Service Object route ownership and initial scheduling order

When a Service Object is created or otherwise reaches the governed trigger for route initialization, EIP resolves the applicable route once, snapshots the explicit Process Definition identities/versions and governed route provenance, and stores the result on the Service Object.

The canonical order is:

```text
SERVICE OBJECT CREATED / TRIGGERED
  -> discover bounded candidate processes
  -> resolve which apply
  -> order them using governed route metadata
  -> pin Process Definition versions
  -> persist route snapshot on Service Object
  -> Planning/Scheduling calculates dates/times for the route
  -> governed Macro Effects patch the accepted schedule into the saved route
  -> as each route process becomes mature, orchestration starts its pinned Process Instance
```

The orchestrator follows the saved route. It does not rediscover/rebuild the route after each completed Process Instance and it does not calculate the schedule itself.

A deliberate route migration is the mechanism for changing an in-flight Service Object to a newly published route.

---

## 6. Route schedule projection

For V1, current scheduling output belongs to the saved route projection and is explicitly separate from pinned route identity metadata.

Conceptually each route step may contain:

```json
{
  "step_code": "EXECUTE",
  "process_def_id": "...",
  "process_version": 4,
  "state": "PENDING",
  "schedule_v1": {
    "planned_start_at": "2026-09-04T08:00:00.000Z",
    "planned_finish_at": "2026-09-04T16:00:00.000Z",
    "source_code": "CURRENT_SCHEDULE",
    "revision": "42"
  }
}
```

The schedule projection is mutable while the route step remains eligible for replanning under governed policy. Changing `schedule_v1` does not change the pinned Process Definition, version, route order or route provenance.

Actual execution facts such as `completed_at` remain distinct from planned dates.

Scheduling simulations/scenarios may calculate candidate schedules without executing the final mutation Effects. Only an accepted/live scheduling result is patched into the operational route.

---

## 7. Route maturity and progression

Each route step has durable orchestration state. Conceptually:

```text
PENDING
ACTIVE
BLOCKED
COMPLETED
SKIPPED
```

A normal progression is:

```text
identify next saved PENDING step
  -> read its current persisted schedule
  -> if no accepted schedule exists: WAIT_SCHEDULE
  -> if planned start is still in the future: WAIT_TIME
  -> when the persisted planned start is reached and the route step is otherwise startable:
       transition route step to ACTIVE
       start/bind the pinned Process Instance
  -> execute that Process through Process Step -> Macro -> reasoning + Effects -> output
  -> when Process Instance completes, mark corresponding route step COMPLETED
  -> inspect the next saved route step
```

The Route Orchestrator is an execution/maturity mechanism, not the scheduling algorithm.

A pending step's persisted schedule may move earlier or later because the Planning/Scheduling process ran again. On its next tick the Route Orchestrator simply consumes the updated saved schedule.

V1 retains one active inter-process route step at a time unless a separately approved cross-domain requirement justifies parallel route orchestration.

---

## 8. Normal versus emergency Scheduling trigger

Normal Scheduling is subordinate to the Planning cycle.

Emergency Scheduling uses the **same** governed Scheduling process but is invoked by an exception/replanning trigger, for example a generic resource/capacity/availability/blocking event that the governed process determines requires rescheduling.

Do not create separate runtime engines such as `EmergencyScheduler`, `MaterialDelayScheduler`, `FleetScheduler`, or similar domain-specific schedulers.

The difference is trigger/scope/policy input, not architecture:

```text
normal cycle
  -> Planning
  -> Scheduling

exception/emergency
  -> governed replanning trigger
  -> same Scheduling process
```

Freeze/unfreeze, planning horizons, cross-object scope and optimization policies belong to the later Scheduling Architecture exercise and must not be guessed inside route runtime.

---

## 9. Route publication and version behavior

Publishing a new route/configuration affects new route resolutions by default.

It must not silently rewrite Service Objects already pinned to an older route.

Conceptually:

```text
new Service Object
  -> current published route

in-progress Service Object
  -> remains on pinned route by default
  -> may be selected for explicit governed route migration

completed Service Object
  -> route is immutable historical record
  -> never migrated
```

This guarantees that EIP can always answer which route an object actually executed.

---

## 10. Route migration

Route migration is an explicit governed operation for in-progress Service Objects only.

Users may select the migration population through governed bounded filters such as object type, status, site, route/version, date range or other approved queryable metadata.

The system must provide a bounded preview/population result before applying a migration campaign where practical.

A route migration must preserve:

- completed-step history;
- previous route identity/digest/version provenance;
- new route identity/digest/version provenance;
- migration timestamp;
- migration policy/campaign identity;
- decision/filter provenance;
- step mapping decisions;
- exceptions requiring review;
- actor/audit identity when the security/audit layer is in scope.

Completed work must not be erased or rewritten merely to make it look as though the new route had always been used.

The system must not guess equivalence between old and new route steps merely from names or position.

Where an active Process Instance exists, the default safe policy is to migrate at an approved boundary, normally after the current active step completes, unless an explicitly governed immediate-migration policy proves interruption safe.

Changing only the persisted current schedule of a pending step is not a route migration. Migration is required when the pinned route itself changes: Process Definition selection/version, route-step composition/order, or other governed route identity/provenance that defines `WHAT NEXT`.

---

## 11. No hardcoded business `what`

Runtime code may implement generic mechanics such as:

- bounded route loading;
- version pinning;
- state transitions;
- persisted schedule/maturity checks;
- candidate limits;
- idempotency;
- transaction/locking behavior;
- generic reasoning execution;
- Effect dispatch;
- generic calculation/resolution functions admitted under the operating-model canon.

Runtime route code must not contain tenant/domain branches such as:

```text
if sales order then approval
if hospital then triage
if manufacturing then production
if ecommerce then shipment
if material late then swap orders
```

Those belong in governed Process Definitions, metadata, Profile Packs, policies, current facts and Planning/Scheduling reasoning inputs.

---

## 12. Architecture consequence for current Wave 3 runtime

The route runtime must not become a hidden scheduler.

The correct Wave 3 boundary is:

```text
route initialization
  -> save pinned route

Planning/Scheduling Process
  -> Macro reasoning using existing generic temporal/resource functions
  -> Effects patch accepted route schedule

route runtime
  -> read persisted schedule
  -> WAIT_SCHEDULE if absent
  -> WAIT_TIME if planned start is future
  -> start pinned Process Instance when mature
```

Any implementation that calculates route timing from calendars, capacity, previous-step delays or external schedule projections inside the Route Orchestrator is implementation drift and must be refactored back into the Planning/Scheduling Process + Macro boundary.
