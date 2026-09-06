# EIP Route Schedule Maturity Gate V1

Date: 2026-09-01

Status: Wave 3 implementation contract under `EXECUTION_AND_ROUTE_CANON.md`, `TASK_EFFECT_MODEL.md`, `OPERATING_MODEL_CANON.md`, and the existing route runtime contracts.

## 1. Purpose

A saved route defines `WHAT NEXT` for a Service Object. Planning/Scheduling calculates `WHEN` each pending route process should run and persists the accepted schedule back into the saved route.

The Route Maturity Gate is deliberately narrow:

```text
saved route step
  -> read persisted schedule
  -> if schedule missing: WAIT_SCHEDULE
  -> if planned start is future: WAIT_TIME
  -> if planned start has been reached: permit Process Instance start
```

The gate does not calculate dates, invoke calendar arithmetic, search capacity, rank resources, or perform scheduling optimization.

Those calculations belong to the governed Planning/Scheduling Process and its Macro reasoning.

## 2. Canonical order

The accepted architecture is:

```text
SERVICE OBJECT CREATED / TRIGGERED
  -> route applicability resolution
  -> version-pinned route persisted on Service Object
  -> Planning/Scheduling calculates route process dates/times
  -> Macro Effects patch accepted schedule into the saved route JSONB
  -> Route Orchestrator observes the current persisted schedule
  -> each route process starts when it becomes mature for execution
  -> Process Engine executes Process Step/Task -> Macro -> reasoning + Effects -> output
```

The route runtime consumes the schedule. It is not the scheduler.

## 3. Process Engine / Macro boundary

The Process Engine model remains:

```text
PROCESS
  -> STEP / TASK
  -> MACRO
       -> logic / calculation / decision resolution
       -> Effect 1
       -> Effect 2
       -> Effect n
  -> OUTPUT / resulting state
  -> next transition / next step
```

For Planning/Scheduling, the Macro may call the existing generic reasoning/calculation capabilities such as:

- arithmetic/comparison/collection reasoning;
- calendar/working-time functions;
- work-requirement calculation;
- capacity-slot resolution;
- workstation/resource resolution;
- a future bounded generic solver only if ordinary composition is proven insufficient.

The accepted Scheduling result is then persisted through governed Object_Effects. The route runtime must not duplicate those calculations.

## 4. Persisted schedule projection

V1 stores the current accepted schedule on each saved route step, conceptually:

```json
{
  "step_code": "EXECUTE",
  "sequence": 300,
  "process_def_id": "...",
  "process_code": "EXECUTE_WORK",
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

The mutable `schedule_v1` projection is separate from pinned route identity/provenance.

Supported V1 fields are:

```text
planned_start_at
  current accepted planned start instant; required for a scheduled step

planned_finish_at
  current accepted planned finish instant; optional to the maturity gate but normally produced by Scheduling

source_code
  opaque scheduling provenance code

revision
  opaque schedule revision/version identifier
```

The Route Maturity Gate interprets only `planned_start_at` for start timing. It carries the other schedule fields for provenance/inspection but does not perform planning logic with them.

## 5. Unscheduled route step

After route resolution the route may exist before Planning/Scheduling has written dates.

An unscheduled PENDING step must fail closed:

```text
state = PENDING
action = WAIT_SCHEDULE
```

It must not start merely because the route exists.

This enforces the canonical order:

```text
route resolved
  -> schedule calculated/persisted
  -> operational route execution
```

## 6. Maturity rule

For a PENDING route step with an accepted `schedule_v1`:

```text
now < planned_start_at
  -> WAIT_TIME

now >= planned_start_at
  -> route step is temporally mature
  -> normal route coordinator may transition it ACTIVE and start/bind its pinned Process Instance
```

This V1 maturity gate is intentionally simple. It does not invent freeze rules, emergency overrides, capacity revalidation, critical-path policy, material logic, or other scheduling semantics.

Any additional release condition must first be classified correctly as one of:

- route state/dependency mechanic;
- governed Process/transition condition;
- Planning/Scheduling policy;
- future separately approved generic maturity constraint.

It must not be hidden inside route runtime.

## 7. Dynamic replanning

A pending route step's schedule may move earlier or later without route migration.

Conceptually:

```text
route remains pinned

schedule revision 41
  STEP_B planned 14:00

conditions change
  -> normal planning cycle OR emergency replanning trigger
  -> same governed Scheduling process executes again
  -> accepted revision 42 is patched into the route

schedule revision 42
  STEP_B planned 11:00
```

The Route Orchestrator does not receive an external transient schedule map. It reads the latest persisted `schedule_v1` from the Service Object route snapshot on each persisted tick.

A previous `WAIT_TIME` result is merely an observation. The next persisted route read may contain a different schedule revision.

## 8. Normal planning versus emergency scheduling

Scheduling is a subprocess of Planning and normally runs according to the Planning cycle.

The same Scheduling process can also be triggered independently when a governed exception/emergency requires replanning.

```text
NORMAL
Planning cycle
  -> Scheduling subprocess

EMERGENCY
exception/replanning trigger
  -> same Scheduling process
```

Do not create `EmergencyScheduler`, `MaterialDelayScheduler`, `FleetScheduler`, or equivalent domain engines.

The difference is the trigger, scope and governed inputs/policies.

## 9. Cross-object reprioritization

Cross-object sequencing is a Planning/Scheduling concern, not a route-runtime concern.

For example:

```text
Object A was planned earlier
Object B was planned later
current governed facts change
Scheduling recalculates affected scope
Object B receives earlier dates
Object A receives later dates
Effects patch both accepted route schedules
```

The route runtime simply enforces each Service Object's latest persisted route schedule.

It must not contain branches such as `material late`, `swap production orders`, `patient priority`, `vehicle priority`, or similar domain semantics.

## 10. Calendar/capacity/resource boundary

The existing temporal/resource capabilities remain valid and reusable. Their architectural placement is corrected:

```text
Planning/Scheduling Macro reasoning
  -> calendar functions
  -> capacity-slot functions
  -> workstation/resource functions
  -> other admitted generic reasoning
  -> calculated schedule
  -> Effects persist accepted schedule
```

Not:

```text
Route Orchestrator
  -> calendar
  -> capacity
  -> calculate schedule
```

Therefore the Route Maturity Gate no longer accepts caller-supplied calendar layers or caller-supplied dynamic schedule projections.

## 11. Completion timestamp

When a bound Process Instance reaches `completed`, its `ended_at` may continue to be recorded as the route step's bounded `completed_at` orchestration fact.

That is actual execution history, not planned schedule.

```text
schedule_v1.planned_finish_at
  = plan

completed_at
  = actual route execution fact
```

The two must remain distinct.

## 12. Route migration compatibility

Changing only `schedule_v1` on pending work is replanning, not route migration.

Route migration is required only when the pinned `WHAT NEXT` changes, including Process Definition/version selection, route-step composition/order, or route identity/provenance.

Completed route history remains immutable.

## 13. Refactor consequence for the previous temporal-gate implementation

The previous implementation incorrectly allowed route runtime to derive eligibility from:

- `not_before_at` policy;
- previous-step elapsed delay;
- previous-step working delay;
- calendar resolution;
- caller-provided dynamic schedule maps.

That placed Scheduling responsibility inside route orchestration.

This contract supersedes that behavior.

Wave 3 route runtime must now only:

```text
read persisted schedule
  -> WAIT_SCHEDULE when absent
  -> WAIT_TIME until planned_start_at
  -> start when mature
```

Any future scheduling sophistication belongs to the Planning/Scheduling Process and its Macro reasoning, not this gate.

## 14. No architecture expansion

This refactor requires:

```text
new tables               0
new migrations           0
new Effects              0
new reasoning operators  0
new domain schedulers    0
```

It reuses the current route JSONB projection and existing Process/Macro/Effect architecture while restoring scheduling authority to the governed Planning/Scheduling process.
