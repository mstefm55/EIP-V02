# EIP Planning and Scheduling Metadata V1

Date: 2026-09-01

Status: Approved architecture direction for Planning/Scheduling engine completion. This contract is schema-neutral in V1: it defines ownership, metadata vocabulary and runtime boundaries without creating new tables.

Read with:

- `OPERATING_MODEL_CANON.md`
- `TASK_EFFECT_MODEL.md`
- `EXECUTION_AND_ROUTE_CANON.md`
- `TEMPORAL_RESOURCE_V1.md`
- `ROUTE_TEMPORAL_GATE_V1.md`

---

## 1. Purpose

EIP must support materially different planning and scheduling concepts by tenant without introducing tenant-specific scheduler code.

The standard mechanism is:

```text
TENANT / PROFILE PACK METADATA
        +
AUTHORITATIVE MASTER FACTS
        +
SERVICE OBJECT DEMAND / ROUTE
        |
        v
PLANNING / SCHEDULING PROCESS
        |
        v
STEP / TASK
        |
        v
MACRO
   +----+------------------------------------+
   |                                         |
   v                                         v
bounded reasoning / calculation          Effects
   |                                         |
   +--> calendars                            |
   +--> capacity                             |
   +--> resources                            |
   +--> work standards                       |
   +--> ranking / constraints                |
   +--> bounded loops / IF                   |
   +--> optional generic solver              |
   |                                         |
   +------------> $calc result --------------+
                                             |
                                             v
                               accepted persistent state
```

The route orchestrator does not calculate the schedule. It consumes the persisted accepted schedule and starts a pinned Process Instance only when its next route step is mature.

---

## 2. Authoritative metadata ownership rule

A fact belongs to the kernel object that owns the fact. Planning/Scheduling composes authoritative facts; it is not their master-data repository.

Canonical ownership:

```text
Process / Process Definition
  -> operation semantics
  -> sequence/dependencies
  -> required capabilities
  -> standard process phases
  -> standard process work requirement
  -> process-level fixed/run/setup logic

Asset
  -> machine/equipment capability
  -> physical capacity
  -> machine-specific rates
  -> machine-specific cycle components
  -> process-specific machine standards
  -> min / average(preferred) / max load envelope
  -> asset operating attributes

Agent
  -> employee/person/organization identity
  -> skills/capabilities
  -> certifications
  -> employee/resource attributes

Material
  -> UOM
  -> item/material properties
  -> item planning parameters where item-owned
  -> lot/yield/scrap/master-data attributes where applicable

Service Object
  -> actual demand/order/case/job requirement
  -> quantity
  -> requested/due dates
  -> priority/customer requirement
  -> pinned route
  -> current route schedule/runtime state

Planning/Scheduling policy metadata
  -> how authoritative facts are interpreted
  -> scope
  -> ranking
  -> planning method
  -> capacity mode
  -> freeze policy
  -> exception/replanning policy
  -> bounded execution/solver settings
```

A relationship-specific fact may be represented on the owner projection in V1 when bounded and natural. Example:

```text
asset.attrs.process_standards.DYEING.fill_minutes
```

This means: this Asset's standard when executing the DYEING Process. It must not be duplicated as a universal DYEING Process fact.

Relational promotion of heavily queried relationship metadata remains a future owner-approved schema decision, not an automatic consequence of this contract.

---

## 3. Scheduling policy describes rules, not master facts

Scheduling policy may state:

```text
rank by customer priority then due date
use finite capacity
schedule backward from requirement date
respect explicit freeze
allow alternative capable resources
raise exception when frozen work becomes infeasible
```

Scheduling policy must not become the repository for:

```text
Machine A max batch = 1200 kg
Machine B fill time for DYEING = 24 minutes
Employee 42 is certified for CHEMICAL_HANDLING
Order 1007 quantity = 840 pcs
```

Those remain on their authoritative objects.

---

## 4. Standard Planning and Scheduling policy vocabulary

Conceptual V1 metadata contract:

```text
PLANNING_CONTROL_POLICY_V1
|
+-- manufacturing_environment
+-- planning_hierarchy
+-- demand_policy
+-- master_schedule_policy
+-- mrp_policy
+-- capacity_policy
+-- scheduling_policy
+-- setup_policy
+-- release_control
+-- freeze_policy
+-- exception_replanning
+-- objectives
+-- execution_limits
```

This vocabulary is metadata, not a set of hardcoded domain branches.

---

## 5. Manufacturing environment reference metadata

Reference Profile Packs may provide defaults for common APICS/ASCM planning environments without changing the kernel:

```text
MTS
ATO
MTO
ETO
HYBRID
```

Typical default emphasis only:

```text
MTS
  -> forecast/customer-order consumption
  -> finished-goods/master-schedule emphasis
  -> replenishment/rate/inventory control

ATO
  -> component/subassembly availability
  -> final assembly against demand

MTO
  -> order-driven requirements
  -> due-date/material/capacity planning
  -> detailed finite scheduling commonly important

ETO
  -> project/design maturity
  -> evolving product structure
  -> long-lead and project dependency control

HYBRID
  -> governed decoupling rules by product/process family
```

These are defaults, not runtime `if strategy == MTO` branches.

---

## 6. MPS -> MRP -> Capacity -> Scheduling as governed Processes

A reference closed-loop planning flow may be composed as:

```text
S&OP / approved aggregate plan
        |
        v
MASTER SCHEDULING
        |
        v
RCCP
        |
        +-- infeasible -> governed planning decision / revise plan
        |
        v
MRP
        |
        v
CRP
        |
        +-- infeasible -> governed planning decision / revise material/capacity plan
        |
        v
DETAILED SCHEDULING
        |
        v
accepted route schedules
        |
        v
EXECUTION / PAC
        |
        v
actual feedback / exception -> governed replanning trigger
```

These are Process/subprocess semantics over the same Process Engine, not peer ERP engines.

### 6.1 Standard MRP metadata dimensions

Conceptual metadata may include:

```text
requirements source
netting policy
on-hand inclusion
scheduled receipts
allocations
lot-sizing method
lead-time offset policy
safety stock
safety lead time
yield/scrap treatment
reschedule-in/out exception handling
cancel/expedite exception handling
planning horizon
```

MRP computation can use bounded loops across BOM levels and planning periods. Business review/replan loops remain Process graph loops.

---

## 7. Work requirement modes

A Process operation must describe the kind of work it requires. Candidate-specific resource facts then resolve actual duration/capacity consumption.

Supported/reference modes:

```text
FIXED_DURATION
RATE_BASED
TIME_PER_UNIT
FIXED_WORK_CONTENT
BATCH_CYCLE
```

A future general formula should be admitted only through existing governed reasoning composition rather than a tenant-defined executable language.

### 7.1 Fixed duration

```text
heat treatment cycle = 360 minutes
```

Duration is independent of candidate rate unless candidate-specific process standard is explicitly part of the requirement.

### 7.2 Rate based

```text
quantity / candidate rate = duration

1000 kg / 250 kg per hour = 4 hours
600 pcs / 120 pcs per hour = 5 hours
```

Units must be dimensionally compatible and fail closed on mismatch.

### 7.3 Time per unit

```text
500 pcs * 0.03 hours/pc = 15 hours
```

### 7.4 Fixed work content

```text
required labor = 24 man-hours
```

Elapsed duration may depend on permitted parallel crew size; labor consumption remains 24 man-hours.

### 7.5 Batch cycle

Batch-cycle work may combine Process-owned and Asset/process-owned components.

Example process definition:

```text
DYEING
  FILL      -> Resource/Process standard
  PROCESS   -> Process standard = 360 minutes
  DRAIN     -> Resource/Process standard
  CLEAN     -> Resource/Process standard
```

Asset-specific standards:

```text
Machine A
  fill  = 48 min
  drain = 42 min
  clean = 30 min
  cycle = 480 min / 8.0 h

Machine B
  fill  = 24 min
  drain = 36 min
  clean = 30 min
  cycle = 450 min / 7.5 h

Machine C
  fill  = 90 min
  drain = 78 min
  clean = 60 min
  cycle = 588 min / 9.8 h
```

The same Process can therefore have a different candidate-specific duration without duplicating the Process Definition.

---

## 8. Min / average / max load envelope

Assets/process standards may expose a governed load envelope for batch or other capacity-sensitive operations.

Conceptual metadata:

```json
{
  "process_standards": {
    "DYEING": {
      "load": {
        "unit": "kg",
        "min": 400,
        "average": 900,
        "max": 1200,
        "min_policy": "SOFT"
      }
    }
  }
}
```

Semantics:

```text
min
  -> minimum/reference load for the Asset/Process combination
  -> HARD means below-min is not feasible
  -> SOFT means schedulable but flagged BELOW_MIN

average
  -> typical/preferred planning load
  -> not a hard feasibility constraint by itself
  -> may contribute to utilization/cost/objective ranking

max
  -> maximum admissible load
  -> exceeding it fails closed for candidate feasibility
```

The runtime may expose bounded provenance such as:

```text
load status
ratio_to_average
ratio_to_max
```

This lets Scheduling distinguish:

```text
physically impossible
operationally possible but inefficient
near preferred load
high but admissible load
```

without hardcoding industry semantics.

---

## 9. Capacity dimensions

Capacity is dimensional. EIP must not treat all capacity as one scalar.

Examples:

```text
kg/hour
pcs/hour
cases/hour
machine-hours
man-hours
batch kg
payload kg
volume m3
concurrent units
```

A single operation may simultaneously consume multiple capacity dimensions.

Example:

```text
1000 kg batch
Machine rate/cycle -> 4 machine-hours
2 operators * 4 hours -> 8 man-hours
physical batch load -> 1000 kg
```

Candidate feasibility therefore composes:

```text
physical capacity
+ capability eligibility
+ candidate-specific duration
+ machine/calendar availability
+ labor/resource availability
+ reservations
+ scheduling policy
```

---

## 10. Setup/changeover metadata

Setup is part of planning/scheduling metadata but setup facts remain with the owning Process/Asset relationship where appropriate.

Reference policy dimensions:

```text
setup mode
  NONE
  FIXED
  SEQUENCE_DEPENDENT

setup family expression
setup matrix source
same-family standard
fallback changeover standard
setup-reduction objective weight
lateness/service objective weight
```

The Scheduling calculation may choose a non-minimum-setup sequence when governed objectives give higher priority to due-date/service protection.

---

## 11. Scheduling policy dimensions

Reference scheduling metadata:

```text
scope
trigger
planning horizon
direction: FORWARD | BACKWARD
capacity mode: FINITE | INFINITE
release policy: PUSH | PULL
ranking expressions
constraint expressions
partial/whole allocation
preemption/split policy
alternative-resource policy
freeze policy
objective weights
bounded iteration/solver limits
```

Field paths and ranking expressions are tenant/Profile-Pack metadata, not runtime domain branches.

---

## 12. IF, loops and solver boundary

The metadata model must remain expressive without becoming arbitrary tenant code.

Placement rule:

```text
IF changes business workflow
  -> Process transition/guard

IF calculates a value
  -> Macro reasoning lazy IF

loop repeats business activity/review
  -> Process graph loop

loop iterates bounded data/candidates
  -> Macro reasoning bounded loop

large combinatorial search
  -> optional generic bounded scheduling/optimization solver
```

No tenant JavaScript, SQL, imports, network calls or arbitrary executable code are admitted into reasoning metadata.

Execution remains bounded by engine hard limits even when tenant metadata specifies a lower operating limit.

---

## 13. Freeze and emergency replanning

Reference freeze zones may include:

```text
FROZEN
SLUSHY
LIQUID
```

Explicit object/step freeze is supported conceptually.

Normal scheduling:

```text
Planning cycle -> Scheduling Process
```

Emergency scheduling:

```text
resource unavailable
material-date change
priority change
blocked process
demand change
other governed exception
        |
        v
same Scheduling Process
```

Reference preservation rule:

```text
COMPLETED -> immutable
FROZEN -> preserve
FROZEN + infeasible -> raise exception, do not silently move
mutable pending work -> eligible for governed recalculation
```

---

## 14. S&OP / IBP aggregation and disaggregation

Serious S&OP must not stop at one aggregate demand number.

Canonical conceptual cycle:

```text
individual demand
  customer orders / forecasts / other demand objects
        |
        v
aggregate by governed planning dimensions
  product/family/site/region/period/etc.
        |
        v
supply/capacity scenarios
        |
        v
candidate aggregate plan
        |
        v
disaggregate to individual demand
        |
        v
measure consequences
  service / OTIF / backlog / fill / priority / margin / risk
        |
        v
acceptable?
  YES -> approve
  NO  -> revise scenario through Process loop
```

The aggregation/disaggregation computation may iterate many customer demands and variable order sizes through bounded collection logic or a solver when required.

---

## 15. Route schedule persistence boundary

The saved route owns the current accepted route schedule projection.

Conceptually:

```text
service_object.attrs
  ._eip_runtime
  .process_route_v1
  .steps[]
  .schedule_v1
```

Reference schedule fields:

```text
planned_start_at
planned_finish_at
source_code
revision
freeze/protection provenance where approved
```

Planning/Scheduling calculates the answer. Generic Effects persist accepted results. Route orchestration reads/enforces the result.

A schedule revision does not by itself constitute route migration.

---

## 16. API / UI Engine handoff contract

The UI Engine must consume governed metadata and runtime projections rather than re-implement scheduling semantics.

UI-facing concepts should be obtainable generically as metadata/data projections:

```text
Process/route steps
planned vs actual dates
maturity / wait reason
resource candidates
load min / average / max
current load status
capacity required vs available
schedule revision
freeze state
exceptions
reasoning/provenance summary
```

The UI may visualize/edit governed policy fields when authorized, but changing presentation must never redefine Process/Scheduling semantics in frontend code.

---

## 17. V1 engine completion criteria

Before considering the Planning/Scheduling foundation ready for the first UI slice:

1. route resolution/persistence remains version-pinned and bounded;
2. route runtime consumes persisted schedule only;
3. Process Engine resolves Macro reasoning before ordered Effects;
4. work requirement supports fixed and rate-dependent candidate duration;
5. batch-cycle candidate duration is supported from Process + Asset/process standards;
6. min/average/max load envelope is validated dimensionally;
7. calendar/capacity/resource calculations remain reusable/domain-neutral;
8. no scheduling-specific Effect is introduced merely to patch routes;
9. safe generic nested/bounded Service Object patch capability is available for accepted schedule persistence;
10. Scheduling policy metadata is versioned/governed and bounded;
11. normal and emergency scheduling use the same governed Scheduling process;
12. API exposes enough generic projections for UI Engine composition without frontend business logic.

---

## 18. No architecture expansion by default

This contract does not by itself justify:

```text
new scheduling table
new capacity table
new machine table
ManufacturingScheduler
HealthcareScheduler
FleetScheduler
MRPEngine as a peer of Process Engine
CRPEngine as a peer of Process Engine
SchedulingEngine as a peer of Process Engine
```

New persistence or generic solver capabilities require evidence, reuse justification and existing owner-approval rules.
