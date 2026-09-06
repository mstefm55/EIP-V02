# EIP Optional MPC Planning Profile V1

Date: 2026-09-01

Status: Approved optional planning-profile architecture. This profile does not redefine the EIP kernel, Process Engine, Scheduling boundary, or persistence model.

Read with:

- `PLANNING_AND_SCHEDULING_METADATA_V1.md`
- `OPERATING_MODEL_CANON.md`
- `EXECUTION_AND_ROUTE_CANON.md`
- `TEMPORAL_RESOURCE_V1.md`
- `TASK_EFFECT_MODEL.md`

---

## 1. Purpose

EIP may offer an APICS/ASCM-style Manufacturing Planning and Control (MPC) operating model to tenants that want a classical closed-loop manufacturing planning hierarchy.

MPC is an optional Profile Pack composed from existing EIP capabilities. It is not a new peer engine and it is not mandatory for tenants.

Canonical rule:

```text
MPC != EIP architecture

MPC = one governed planning operating model
      expressed through the EIP Process Engine,
      metadata, generic planning calculations,
      Scheduling, Effects and feedback.
```

A small tenant may use:

```text
Planning
  -> Scheduling
  -> Execution
```

A tenant selecting the MPC profile may use:

```text
Demand Management
  -> S&OP
  -> Master Scheduling
  -> RCCP
  -> MRP
  -> CRP
  -> Detailed Scheduling
  -> Execution / PAC
  -> feedback / replanning
```

Both use the same kernel.

---

## 2. MPC hierarchy mapped to EIP

Reference mapping:

```text
MPC FRONT END

Demand Management
      |
      +-------------------+
      |                   |
      v                   v
S&OP / Production Plan   Resource Planning
      |                   |
      +---------+---------+
                |
                v
        Master Scheduling / MPS
                |
                v
        Rough-Cut Capacity / RCCP
                |
                v
MPC ENGINE

        Material Planning / MRP
                +
        Detailed Capacity / CRP
                |
                v
MPC BACK END

        Detailed Scheduling
                |
                v
        Execution / PAC
                |
                +--> Supplier / external execution Processes where applicable
                |
                v
        actuals / exceptions / feedback
                |
                +---------------------------> governed replanning
```

EIP representation:

| MPC concept | EIP representation |
| --- | --- |
| Demand Management | Governed demand Processes and Service Objects |
| S&OP | Optional S&OP/IBP Process Pack |
| Resource Planning | Planning Process using resource/capacity projections |
| Master Scheduling / MPS | Governed Planning subprocess / Macro calculations |
| RCCP | Aggregate capacity reasoning using generic capacity projections |
| MRP | Material-planning Process using governed metadata and bounded calculation |
| CRP | Detailed capacity reasoning over routing/work requirements |
| Detailed Scheduling | Governed Scheduling subprocess |
| PAC / Shop-floor control | Execution Processes, route orchestration and tasks |
| Supplier scheduling | Supplier/procurement Processes |
| Closed-loop feedback | Actuals/exceptions triggering governed planning decisions |

No `MPSEngine`, `MRPEngine`, `CRPEngine`, `PACEngine`, or `MPCEngine` is introduced as a peer of the Process Engine.

---

## 3. Optional planning profiles

EIP may expose planning profiles as governed Profile Packs.

Reference levels:

```text
BASIC
  Planning
    -> Scheduling
    -> Execution

MPC_STANDARD
  Demand Management
    -> S&OP
    -> Master Scheduling
    -> RCCP
    -> MRP
    -> CRP
    -> Detailed Scheduling
    -> Execution / PAC
    -> closed-loop feedback

IBP_ENTERPRISE
  Strategic / financial objectives
    -> IBP / S&OP
    -> Demand and Supply Planning
    -> Master Scheduling
    -> Material and Capacity Planning
    -> Scheduling
    -> Execution
    -> scenario / performance feedback
```

Profile selection changes governed Process definitions, policy metadata and available planning surfaces. It must not change kernel semantics.

A tenant may also compose a hybrid profile rather than adopting every MPC layer.

---

## 4. Planning horizon and level-of-detail principle

MPC reinforces a core EIP planning rule: planning becomes more detailed as the time horizon approaches execution.

Conceptually:

```text
LONG RANGE
  aggregate demand / supply / resource envelope
        |
        v
MEDIUM RANGE
  product/family/site/master schedule
        |
        v
MATERIAL + CAPACITY PLAN
  items / routings / work centers / periods
        |
        v
DETAILED SCHEDULE
  exact executable work, resources and dates
        |
        v
EXECUTION
  actual task/process state
```

This aligns with governed time-fence policies:

```text
LIQUID
  -> distant horizon; broad automatic recalculation may be allowed

SLUSHY
  -> intermediate horizon; conditional change

FROZEN
  -> near-term accepted/released work; preserve unless governed override/exception permits change
```

These zones remain policy metadata, not hardcoded MPC behavior.

---

## 5. Closed-loop planning

The optional MPC Profile must be closed-loop.

Canonical pattern:

```text
PLAN
  -> validate material feasibility
  -> validate capacity feasibility
  -> accept / release
  -> schedule
  -> execute
  -> capture actuals
  -> detect variance / shortage / breakdown / lateness / demand change
  -> governed decision: replanning required?
  -> same Planning/Scheduling processes when replanning is authorized
```

Normal planning and exception replanning must therefore use the same governed processes.

Examples of feedback facts:

```text
actual completion
actual yield/scrap
resource breakdown
resource performance variance
material shortage or late receipt
supplier failure
priority change
new urgent demand
quality block
actual duration variance
inventory discrepancy
```

The fact source owns the fact. MPC Processes consume the fact; they do not become its master-data repository.

---

## 6. MPS boundary

Master Scheduling converts an approved aggregate plan and demand facts into time-phased master-schedule requirements at a governed planning level.

The master-schedule level is metadata and may vary by manufacturing environment or product family.

Reference defaults:

```text
MTS
  -> commonly finished-good/master-item emphasis

ATO
  -> commonly modules/subassemblies plus final-assembly control

MTO
  -> commonly order-driven planning farther upstream

ETO
  -> commonly project/design release plus evolving material requirements
```

These are Profile Pack defaults only. The runtime must not contain strategy-specific branches such as `if MTO then ...`.

MPS outputs are planning facts/projections consumed by downstream material and capacity planning.

---

## 7. RCCP boundary

RCCP answers a coarse feasibility question before detailed material planning:

```text
Can key/critical resources plausibly support the master schedule?
```

Inputs may include:

```text
master-schedule quantities
planning periods
key-resource standards
resource calendars
rated capacity assumptions
tenant capacity policy
```

Outputs may include:

```text
required key-resource capacity
available capacity
utilization/load ratio
overload/underload exceptions
scenario alternatives
```

RCCP is not detailed finite scheduling. It remains an aggregate planning calculation inside a governed Process/Macro.

---

## 8. MRP boundary

MRP determines time-phased dependent material requirements from governed demand/master-schedule inputs and product/material structure.

Reference calculation sequence:

```text
master requirement
  -> explode product/BOM levels
  -> determine gross requirements
  -> apply scheduled receipts
  -> apply on-hand / allocations according to policy
  -> calculate projected available
  -> calculate net requirement
  -> apply lot-sizing rule
  -> calculate planned order receipt
  -> offset by lead time
  -> calculate planned order release
  -> emit exceptions / reschedule signals
```

Reference metadata dimensions:

```text
requirements source
netting policy
lot-sizing method
lead-time policy
safety stock
safety lead time
yield/scrap treatment
planning horizon
firm/planned order treatment
reschedule-in policy
reschedule-out policy
cancel/expedite policy
```

Material-owned parameters stay on Material/master-data projections. MRP policy describes how those facts are used.

MRP calculation loops over BOM levels, demand records and periods may be bounded computational loops. Repeating planning reviews or approvals must remain Process graph loops.

---

## 9. CRP boundary

CRP translates planned/released work through governed routings/work requirements into detailed resource load by period.

Generic conversion examples:

```text
1000 pcs / 100 pcs per hour = 10 machine-hours

500 kg batch with candidate cycle = 7.5 machine-hours

2 employees x 4 elapsed hours = 8 man-hours
```

Required capacity may simultaneously include multiple dimensions:

```text
machine-hours
man-hours
kg/hour
pcs/hour
batch/load envelope
concurrent units
physical payload/volume
```

CRP compares required capacity with authoritative available/rated capacity projections.

If infeasible, the Process decides the business response, for example:

```text
overtime
alternate resource
subcontract
capacity change
master-schedule revision
material-plan revision
priority change
accept lateness
human approval
```

The capacity calculation does not make those business decisions by itself.

---

## 10. Detailed Scheduling boundary

Detailed Scheduling receives approved/plannable work and determines executable timing/resource placement according to governed Scheduling metadata.

It may use:

```text
route/process dependencies
current planning facts
work requirements
resource capabilities
candidate-specific duration
asset process standards
min / average / max loads
setup/changeover
calendars
reservations
freeze/time-fence rules
material availability
priority/ranking policy
forward/backward direction
finite/infinite capacity policy
push/pull release policy
optional generic optimization solver
```

The accepted result is persisted through generic Effects into the authoritative runtime projection.

Route orchestration only consumes/enforces the accepted schedule.

---

## 11. PAC / execution boundary

Production Activity Control is represented through ordinary governed EIP execution mechanisms rather than a separate PAC engine.

```text
accepted/released schedule
  -> route maturity
  -> pinned Process Instance
  -> task/step semantics
  -> Macro
  -> Effects
  -> actual state/history
```

Execution actuals are authoritative operational facts. They may trigger closed-loop planning exceptions but must not be rewritten by planning merely to match a plan.

---

## 12. Metadata-driven adaptation

The MPC Profile must remain adaptable by tenant and industry.

The code owns generic safe capabilities such as:

```text
arithmetic/comparison/boolean
bounded collection operations
bounded loops
working-time/calendar arithmetic
resource/capacity resolution
safe planning projections
generic scheduling/optimization interface when justified
generic Effects
```

Metadata owns:

```text
planning hierarchy enabled for the tenant
planning horizons
master-schedule level
MRP policy
capacity policy
ranking/objectives
freeze/time-fence rules
setup/changeover rules
release policy
exception/replanning triggers
approval points
automation mode
```

No tenant JavaScript, SQL or arbitrary executable program is introduced.

---

## 13. S&OP disaggregation remains required where applicable

Selecting an MPC or IBP Profile does not permit S&OP to operate only on a single aggregate demand scalar.

Where customer/order consequence matters, the governed process should be able to:

```text
collect many individual demands
  -> aggregate by governed planning dimensions
  -> evaluate supply/capacity scenario
  -> produce candidate aggregate plan
  -> disaggregate to individual demand
  -> measure service/backlog/fill/priority/margin/risk consequences
  -> approve or loop to scenario revision
```

Variable order sizes, heterogeneous customers and priorities must therefore remain representable in the demand projection.

---

## 14. UI Engine exposure

The optional MPC Profile may add metadata-driven UI surfaces such as:

```text
Demand Review
S&OP Scenario Review
Master Schedule
RCCP Capacity Review
MRP Exceptions
CRP Load Review
Detailed Schedule
Execution / PAC Exceptions
```

These surfaces are UI Engine metadata over bounded API projections. The frontend must not calculate MRP, capacity or schedules independently.

Tenants not using the MPC Profile should not be forced to see MPC-specific navigation or terminology.

---

## 15. V1 non-goals

Approval of this optional Profile does not approve:

```text
new MPC tables
new MRP tables
new scheduling tables
new capacity tables
hardcoded APICS terminology in EIP Core UI
MRP as a peer engine
CRP as a peer engine
MPC as a peer engine
mandatory MPC workflow for every tenant
```

Persistence is introduced only when an existing owner object cannot safely/efficiently hold the governed fact and the normal owner-approval rules justify a new relational structure.

---

## 16. Reference profile identity

Conceptual Profile Pack identity:

```text
profile_code: MPC_STANDARD
profile_family: PLANNING_CONTROL
profile_version: 1
optional: true
```

This identity is conceptual in V1. It does not create a schema object by itself.

The purpose is to let future tenant onboarding select a mature planning operating model without changing the EIP kernel.