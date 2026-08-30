# EIP Orchestration V1

Date: 2026-08-30

Status: Wave 3 implementation contract under `OPERATING_MODEL_CANON.md` and `TEMPORAL_RESOURCE_V1.md`.

## 1. Purpose

Wave 3 connects work demand, resources, time and multiple Process Definitions without creating domain schedulers or a second workflow engine.

The canonical execution chain remains:

```text
SERVICE OBJECT
  -> route resolution
  -> PROCESS DEF / PROCESS INSTANCE
  -> TASK LABEL / PROCESS SEMANTICS
  -> MACRO
  -> governed reasoning / resolution
  -> OBJECT_EFFECT
  -> OBJECT
```

Security/authentication are outside this modelling wave.

## 2. Work requirement bridge

Capacity cannot be resolved from a workstation calendar alone. The resolver needs work content from the Process/Macro and resource-specific execution capability.

The V1 chain is:

```text
PROCESS / MACRO
  -> WORK REQUIREMENT
       - required capabilities
       - fixed duration OR workload
       - optional fixed overhead
       - rate dimension where workload is rate-dependent
  -> eligible WORKSTATION candidates
  -> candidate-specific duration
  -> candidate calendar
  -> reservations/current load
  -> capacity slot
  -> feasible start/end
```

Two modes are supported.

### Fixed-duration work

```text
process duration = fixed minutes + optional overhead
```

The same required duration is evaluated against each eligible workstation calendar.

### Rate-dependent work

```text
workload amount / candidate rate * rate period
+ optional fixed overhead
= candidate required duration
```

This preserves the distinction between process work content and workstation execution speed.

Example:

```text
10,000 pieces
Line A = 500 pieces/hour -> 1,200 minutes
Line B = 800 pieces/hour ->   750 minutes
```

The capacity resolver then evaluates each duration against that candidate's calendar and reservations.

`workRequirementResolver.js` implements only this generic work-content-to-time conversion. It does not know batch, line, hospital, fleet, retail or ecommerce semantics.

## 3. Capacity resolver responsibility

The capacity resolver remains a slot-finding primitive.

It consumes:

```text
calendar layers
required duration
existing reservations
anchor instant
FORWARD | BACKWARD
split/non-split policy
bounded search limits
```

It does not decide what process should run, which capability is required, or how business workload is calculated.

## 4. Workstation resolver responsibility

The workstation resolver performs:

```text
bounded candidates
-> capability/mobility/minimum-capacity eligibility
-> candidate-specific work duration
-> calendar + reservation slot resolution
-> ranked feasible candidates
```

Persistence-side candidate queries must narrow the set before the JavaScript resolver is invoked. The resolver candidate limit remains a fail-closed safety boundary, not a substitute for indexing/query design.

## 5. Inter-process routing

`process_binding` is an applicability mapping. In the current schema it maps tenant + Service Object type (+ optional task type) to a Process Definition with priority.

It must not silently become the entire ordered lifecycle-routing model.

Current runtime `resolveBoundProcessDef` selects one applicable Process Definition by priority. That remains valid for single-process starts, but it does not yet represent an ordered multi-process route.

Wave 3 therefore introduces a separate route-plan contract.

## 6. Route plan V1

A route plan is an ordered, bounded snapshot of Process Definitions applicable to one Service Object lifecycle.

Conceptually:

```text
SERVICE OBJECT
  -> ROUTE SNAPSHOT
       100 VALIDATE_ORDER  process_def v2
       200 PLAN_WORK       process_def v7
       300 EXECUTE_WORK    process_def v4
       400 SHIP            process_def v3
```

Each route step snapshots at minimum:

- stable step code;
- explicit `process_def_id`;
- process code where available;
- process version where available;
- sequence;
- state;
- bounded attrs/provenance.

The V1 step states are:

```text
PENDING
ACTIVE
BLOCKED
COMPLETED
SKIPPED
```

V1 deliberately permits only one active route step at a time. Parallel inter-process orchestration is not admitted until a real cross-domain requirement cannot be expressed cleanly by process-internal parallelism/composition.

## 7. Applicability versus sequencing

The route planner does not own business-condition evaluation.

Input entries may already be marked `applicable=false` by governed reasoning/resolution. The route planner filters those entries and orders the remainder.

This avoids inventing a second condition language inside routing.

Target separation:

```text
PROCESS BINDING / PROFILE / GOVERNED METADATA
  -> candidate processes
GOVERNED REASONING
  -> applicability results
ROUTE PLANNER
  -> ordered version-pinned snapshot
PROCESS SCHEDULER
  -> start next Process Instance when allowed
```

The exact persistence source for route metadata remains open pending evidence. Wave 3 does not add a route table.

## 8. Route snapshot versus live reference data

A Service Object already in flight must not silently adopt a later Process Definition version or Profile Pack revision.

The route snapshot therefore records explicit Process Definition identity/version provenance at route resolution time.

Later reference/profile updates may be offered as controlled changes, but they do not mutate an in-flight route implicitly.

## 9. Process scheduler V1 boundary

The eventual scheduler responsibility is small:

```text
read route snapshot
-> identify ACTIVE/BLOCKED step or next PENDING step
-> start/reuse the referenced Process Instance
-> wait for terminal completion
-> mark route step completed
-> advance to next step
```

It must not execute Macro/Effect logic itself. That remains inside the existing Process Engine.

The scheduler must be idempotent and bounded when integrated.

## 10. Persistence decision intentionally deferred

Wave 3 adds no `route`, `scheduler`, `work_requirement`, `workstation`, `calendar` or `capacity` table.

Before schema expansion, test whether route snapshots/provenance can be represented safely through existing governed structures such as Service Object/process-instance metadata, `object_link`, `info_record`, and Process Definition/binding metadata.

If query integrity, lifecycle or performance proves those structures insufficient, prepare an explicit schema proposal under the new-table justification process.

## 11. JSONB/query constraints

Routing and resource resolution must comply with `SPECIALIZED_APP_JSONB_SCALING_STRATEGY.md`.

Do not:

- load every `process_binding` or resource for a tenant and filter in JavaScript;
- fetch full Service Object `attrs` when only a few paths are needed;
- store growing full calculation payloads inside `cursor_json` history;
- add blanket indexes to compensate for poor query shape.

Prefer bounded projections, indexed relational predicates and digest/provenance records.

## 12. Current implementation status

Implemented on the Wave 3 branch:

```text
workRequirementResolver.js
  fixed-duration and rate-dependent candidate duration

workstationResolver.js
  now feeds candidate-specific duration into calendar/capacity resolution

processRoutePlanner.js
  bounded ordered route snapshot
  version provenance
  sequential lifecycle
  active-step conflict prevention
```

Not yet wired into `core_process_engine.js`:

- `$calc.*` Effect references;
- selective `$parent.attrs.*` projection query;
- automatic route snapshot creation;
- automatic next-process start after terminal completion.

Those integrations come only after the pure contracts and existing regression suite pass.

## 13. Quality gates

Before modifying the Process Engine:

1. Wave 1 reasoning tests pass;
2. Wave 2 temporal/resource tests pass;
3. work-requirement tests pass;
4. route-planner tests pass;
5. existing API regression tests pass;
6. no migrations/new tables were introduced;
7. fixed-duration behavior remains backward-compatible;
8. rate-dependent workstation durations are demonstrated;
9. no domain-specific operation has become a generic primitive;
10. candidate and route sizes remain bounded.

## 14. Next integration slice

After the gates pass, integrate only the smallest bridge into the Process Engine:

```text
resolve Macro
-> statically inspect required parent attrs
-> bounded Service Object projection
-> execute Macro reasoning
-> attach bounded `ctx.calc`
-> existing Effects resolve `$calc.*`
-> store calculation audit/digest in history
```

No Effect handler replacement is permitted in this slice.

After that bridge passes regression testing, integrate route advancement separately.
