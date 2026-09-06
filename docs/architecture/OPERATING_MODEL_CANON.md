# EIP Core V2 Operating Model Canon

Date: 2026-08-30

Status: Canonical architecture guardrail for operating-model development.

This document consolidates the operating-model direction for EIP Core V2. It does not replace `KERNEL_CANON.md`, `SERVICE_OBJECT_CANON.md`, or `TASK_EFFECT_MODEL.md`; it constrains how new reasoning, temporal, resource, routing, profile-pack, and UI capabilities may be added without changing the kernel-first architecture.

Security and authentication are outside the scope of this document.

---

## 1. Core invariant

EIP remains kernel-first, engine-based, metadata-driven, and process-driven.

The canonical execution chain remains:

```text
PROCESS
  -> TASK LABEL / PROCESS SEMANTICS
  -> MACRO
  -> OBJECT_EFFECT
  -> OBJECT
```

The Process Engine is not being replaced by manufacturing, scheduling, hospital, fleet, retail, ecommerce, or other domain engines.

New capabilities must first be tested as compositions of the existing kernel, Process Engine, governed reasoning, metadata, and Effects Library.

---

## 2. Process Engine boundary

The Process Engine remains responsible for:

- process definitions;
- graph nodes;
- transitions and guards;
- task labels / human-facing process semantics;
- macro resolution;
- process-instance execution state;
- process history/provenance;
- invoking governed Effects.

A process transition resolves a Macro. A Macro expresses the ordered execution required to achieve the transition intent.

A Macro may consume calculated/resolved values, but calculation does not become a second workflow engine.

The Process Engine must not contain tenant-specific or domain-specific branches such as:

```text
if MTO
if hospital
if ecommerce
if fleet
if batch manufacturing
```

Such variation belongs in process definitions, metadata, policies, Profile Packs, or governed inputs.

---

## 3. Task label versus persisted task

A task label is the human/business-facing wording associated with process semantics.

A persisted `eip_core.task` is created only when durable work-management state is required, such as:

- assignment;
- due date;
- work queue;
- blocked state;
- notes;
- claim/reassign;
- explicit completion;
- audit of human work.

Automatic process steps do not create task rows merely because a task label exists.

A Process Instance and a persisted Task may correspond 1:1 in a simple process, but they retain different responsibilities.

---

## 4. Governed reasoning capability

EIP adds a governed calculation/reasoning capability without changing the Process Engine architecture.

The boundary is:

```text
PROCESS / MACRO
      |
      +--> REASON / CALCULATE / RESOLVE -> result/context
      |
      +--> OBJECT_EFFECTS -> kernel mutation
```

Reasoning is non-mutating. Effects remain the mutation boundary.

The runtime may expose calculated values to Effects through governed Macro context, conceptually similar to:

```text
$calc.production_plan
$calc.selected_workstation
$calc.required_hours
$calc.child_plan
```

The exact context syntax is an implementation contract, not a new architectural layer.

### 4.1 Small-algebra rule

The reasoning library must remain deliberately small.

Initial capability families are:

1. scalar arithmetic / comparison / boolean logic;
2. collection filtering, ordering, selection, and aggregation;
3. allocation primitives where simple composition is insufficient;
4. temporal / calendar arithmetic;
5. resource/capability resolution;
6. bounded solver interfaces only where ordinary composition no longer suffices.

Do not create a generic capability merely because a business operation has a name.

Examples that must remain process/policy compositions rather than core primitives include:

```text
CREATE_BATCH
SELECT_TRUCK
ASSIGN_HOSPITAL_BED
REPLENISH_STORE
ORDER_CONFIRM
MTO_PLAN
ETO_PLAN
RUN_PRODUCTION_LINE
```

### 4.2 Generic Capability Admission Rule

A new reasoning capability is admitted only when all of the following are true:

- it is domain-neutral;
- it is non-mutating;
- it is deterministic or explicitly bounded;
- it is reusable across materially different operating models;
- the same result cannot be expressed cleanly by a small composition of existing primitives;
- its execution cost can be bounded and observed;
- it does not duplicate Process, Macro, or Effect responsibility.

If a candidate can be expressed cleanly using approximately two to four existing primitives, composition is preferred.

---

## 5. Metadata is declarative, not executable code

Governed metadata may compose approved operators and policies.

Metadata must not contain arbitrary executable JavaScript, SQL, imports, filesystem access, or unrestricted network execution.

Forbidden patterns include runtime `eval`, `new Function`, and tenant-authored arbitrary code executed with kernel authority.

The reasoning runtime owns the finite operator vocabulary and execution limits.

Required safeguards include:

- maximum expression depth;
- maximum execution steps;
- maximum loop/iteration count;
- maximum emitted collection size;
- maximum candidate-set size;
- maximum result size;
- rejection of unknown operators;
- rejection of unsafe object/prototype paths;
- rejection of invalid numeric states such as divide by zero or non-finite results.

---

## 6. Object_Effect model

Effects are governed transformations applied to explicit kernel object families.

`domain-neutral` does not mean `one universal CRUD primitive for every table`.

Kernel object boundaries must remain visible in Effect semantics.

Canonical naming direction is `OBJECT_EFFECT`, for example:

```text
SERVICE_OBJECT_CREATE
SERVICE_OBJECT_PATCH
SERVICE_OBJECT_STATE_TRANSITION
TASK_CREATE
TASK_PATCH
TASK_STATE_TRANSITION
INFO_RECORD_CREATE
LINK_CREATE
LINK_PATCH
LINK_REMOVE
PROCESS_START
```

Security-specific grant Effects remain a separate kernel concern.

Business operations such as MRP, order release, allocation decisions, inventory planning, prescription fulfilment, shipment planning, or production scheduling are Process/Macro semantics and must not be promoted into Effects merely for convenience.

One Effect may execute multiple internal functions/SQL statements when all statements implement one coherent indivisible transformation and preserve required invariants.

---

## 7. Service Object decomposition and child objects

A child is a normal `service_object` row, not an embedded child record inside a parent's JSONB.

Parent/child relationships use governed relationships, normally through `object_link`.

A generic decomposition flow is:

```text
PARENT SERVICE OBJECT
      -> governed reasoning / decomposition policy
      -> CHILD PLAN
      -> validate invariants
      -> SERVICE_OBJECT_CREATE + LINK_CREATE
      -> child Service Objects
```

Manual, assisted, recommended, and automatic decomposition should converge on the same governed materialization path.

A child Service Object is created only when the resulting unit requires durable independent identity or lifecycle, for example independent:

- routing;
- state;
- genealogy/traceability;
- assignment;
- scheduling;
- quality control;
- completion;
- audit.

Arithmetic division alone does not justify a child Service Object.

Example:

- production batch with independent genealogy: child Service Object is appropriate;
- continuous line allocation with no independent lifecycle: link/plan/patch may be sufficient;
- ecommerce shipment with independent tracking: child Service Object may be appropriate;
- GPS position observation: event/info record, not child Service Object.

---

## 8. Workstation and resource model

A Workstation is the governed execution capability formed from the resources required to perform work.

Conceptually:

```text
WORKSTATION
  = ASSET(S)
  + AGENT(S) / ENTITY RESOURCES
  + CAPABILITIES
  + AVAILABILITY / CAPACITY CONTEXT
```

A Workstation may be movable or immovable.

Examples include:

- machine + operator;
- assembly bench + tools + operators;
- operating theatre + medical equipment + care team;
- vehicle + driver + equipment;
- mobile maintenance team + tools;
- human-only service workstation.

Work centers, cells, lines, project locations, or other execution groupings are higher-level resource topologies and must not automatically create new kernel tables.

Before adding persistence, test whether existing `agent`, `asset`, `service_object` where appropriate, `object_link`, and governed metadata can represent the topology correctly.

### 8.1 Capability-first assignment

Processes should be able to request required capabilities rather than hardcoded departments or job titles.

This is essential for:

- mature functional organizations;
- cross-functional teams;
- startups with blurred roles;
- mobile service teams;
- healthcare teams;
- shared production resources.

A person may perform several organizational functions without EIP inventing fictional departments.

---

## 9. Time is a first-class dimension

Clock arithmetic is insufficient for operations.

EIP must distinguish:

- timestamp/date;
- elapsed duration;
- working duration;
- interval;
- calendar;
- lead-time structure;
- capacity over time;
- scheduling direction;
- finite/infinite capacity policy.

### 9.1 Calendar model

A governed calendar may include:

- recurring weekly work periods;
- shifts;
- weekends defined by jurisdiction/organization rather than assumption;
- public/bank holidays;
- summer/winter shutdowns;
- partial-day exceptions;
- overtime;
- maintenance closures;
- employee leave;
- site-specific exceptions;
- timezone.

Calendar resolution should support layered inheritance/overrides, conceptually from jurisdiction -> organization -> site -> line/workstation -> resource/agent -> explicit exception.

The exact persistence design remains subject to normal schema justification; the architecture requirement is the deterministic resolver behavior.

### 9.2 Temporal primitives

The generic temporal reasoning layer should cover a small set of primitives such as:

```text
TIME_DIFF
INTERVAL_OVERLAP
INTERVAL_INTERSECTION
IS_WORKING_TIME
NEXT_WORKING_INSTANT
PREVIOUS_WORKING_INSTANT
ADD_WORKING_TIME
SUBTRACT_WORKING_TIME
WORKING_TIME_BETWEEN
```

More complex functions such as `FIND_AVAILABLE_SLOT` may require current state/capacity resolution and therefore belong to a resolver/scheduler capability, not merely scalar arithmetic.

### 9.3 Forward and backward scheduling

Forward and backward scheduling use the same process/routing topology.

- Forward scheduling asks: if work can start at X, what is the earliest feasible completion?
- Backward scheduling asks: if completion is required at Y, what is the latest feasible release/start?

Scheduling direction is policy/metadata, not a separate Process Engine.

Finite versus infinite capacity is another independent policy dimension.

### 9.4 Lead time

Lead time should be decomposable rather than represented only as one opaque number.

Potential components include:

- administration;
- queue;
- setup;
- run;
- wait;
- move;
- inspection;
- external processing;
- transit;
- safety lead time.

Components may be fixed, calculated, calendar-dependent, or capacity-dependent.

### 9.5 Order commitment dates

At minimum, the model should distinguish conceptually:

```text
customer requested date
calculated earliest feasible date
promised/confirmed date
planned completion date
actual completion date
```

Forward and backward passes can be used together to expose slack or lateness before commitment.

---

## 10. Operating-model dimensions

Do not collapse the organization into one `production_model` or equivalent field.

Operating models are composable dimensions.

Examples include:

### Demand / decoupling

```text
MTS
ATO
CTO
MTO
ETO
HYBRID
```

### Transformation / flow

```text
PROJECT
JOB_SHOP
BATCH
CELL
REPETITIVE
LINE
CONTINUOUS
HYBRID
```

### Resource topology

```text
FIXED
MOBILE
HUMAN_ONLY
ASSET_ONLY
HUMAN_ASSET_WORKSTATION
NETWORKED
```

### Scheduling/control

```text
FORWARD / BACKWARD
FINITE / INFINITE
ORDER_BASED / RATE_BASED
```

These dimensions may be combined freely where operationally valid.

The same tenant may use different combinations by site, product, process, Service Object type, or case.

---

## 11. Profile Packs

A Profile Pack is a reusable onboarding/configuration bundle, not a runtime engine.

A Profile Pack packages:

```text
TEXTBOOK / REFERENCE OPERATING SETUP
+ TEXTBOOK PROCESS DEFINITIONS
+ EIP DROPDOWN/FIELD GOVERNANCE
+ DEFAULT LOGIC POLICIES
+ CALENDAR/CAPACITY TEMPLATES
+ RESOURCE/WORKSTATION TEMPLATES
+ PROCESS BINDINGS / TASK TEMPLATES
+ UI/FORM GOVERNANCE METADATA
```

Profiles may use APICS/CPIM and other established operating knowledge as reference material, but textbook terminology must be translated into EIP's canonical kernel/process model rather than copied into special runtime code.

### 11.1 Composition

Avoid hundreds of monolithic profile variants.

Prefer composable reference dimensions, for example:

```text
EIP_FOUNDATION
+ MTO
+ JOB_SHOP
+ BACKWARD_FINITE
+ TWO_SHIFT
+ FLUID_ORGANISATION
```

Friendly curated profile names may be presented in the UI, but the underlying configuration remains a composition of governed metadata.

### 11.2 Instantiation and provenance

A Profile Pack is instantiated into ordinary tenant metadata.

After installation:

```text
tenant metadata = tenant authority
```

The reference pack must not remain hidden runtime authority.

Record provenance such as:

- profile code;
- profile version;
- instantiated timestamp;
- components used;
- later tenant customizations.

A later Profile Pack version must never silently rewrite an existing tenant's processes or metadata.

### 11.3 Startup / fluid organization profile

EIP must support organizations with:

- unclear functions;
- blurred responsibilities;
- founders wearing many hats;
- weak or undocumented processes;
- changing team boundaries.

Do not force fictional departments or mature-process assumptions.

Use capability-based responsibility and a minimal process baseline where appropriate, for example:

```text
INTAKE -> ACTIVE -> REVIEW -> DONE
```

Process maturity can progressively evolve from emergent -> repeatable -> standardized -> optimized without migrating to a different ERP architecture.

---

## 12. Dropdown and field governance

Profile Packs and tenant customization must use the existing governed metadata model rather than creating a parallel configuration system.

Governed concepts include, where applicable:

- Service Object types/categories;
- statuses;
- relation types;
- effect types;
- task types;
- capability types;
- calendar classifications;
- automation modes;
- field/value contracts;
- UI applicability.

Field governance should define, where applicable:

- value type;
- required/optional;
- visibility;
- editability;
- object/process applicability;
- validation;
- dropdown source;
- label/help metadata;
- indexing/query classification.

The UI Engine consumes this metadata. Profile Packs must not ship hidden React business authority.

---

## 13. JSONB, indexing, query shape, and engine-load guardrails

This canon must be read together with `SPECIALIZED_APP_JSONB_SCALING_STRATEGY.md`.

The following rules are binding for the reasoning/resolver work:

1. JSONB remains governed extensibility, not an uncontrolled dumping ground.
2. Query shape is a primary performance risk; row count alone is not the decision rule.
3. Frequently queried JSONB paths must be classified and reviewed for selective indexing/query optimization.
4. Do not add broad GIN indexes automatically.
5. Do not fetch full JSONB documents when only bounded fields are required.
6. Do not promote existing governed JSONB fields into columns/tables automatically; promotion requires explicit owner approval and evidence.
7. Important operational queries require documented predicates, expected cardinality, indexes relied upon, and representative `EXPLAIN (ANALYZE, BUFFERS)` review where practical.

### 13.1 Engine-load rule

The reasoning engine must never compensate for poor query design by loading large tenant datasets into application memory and filtering them there.

Resolvers must narrow candidate sets as close to persistence as practical using governed, index-aware predicates before applying higher-order reasoning.

Bad pattern:

```text
load every workstation / vehicle / bed / order for tenant
-> evaluate all objects in JavaScript
-> choose one
```

Preferred pattern:

```text
bounded indexed candidate query
-> small governed candidate set
-> reasoning/resolution
-> result
```

Every resolver should define:

- input candidate scope;
- maximum candidate count;
- required relational predicates;
- JSONB paths used;
- indexes expected;
- timeout/complexity budget;
- fallback behavior when the candidate set is too large.

### 13.2 Calculation budget

Reasoning programs must be bounded by execution budgets so metadata cannot create accidental CPU amplification.

At minimum measure/limit:

- expression depth;
- operation count;
- loop count;
- collection length;
- candidate count;
- emitted result count;
- execution duration where practical.

Cross-domain flexibility must not be obtained by making the Process Engine an unbounded general-purpose compute engine.

---

## 14. Schema-admission rule

Before proposing a new table or first-class relational structure, ask:

```text
Can service_object, agent, asset, object_link, info_record,
dropdown metadata, process_def.graph/attrs, or another
existing governed structure represent the concept correctly?
```

If yes, use the existing kernel.

If no, ask whether the missing concept is genuinely generic, query-significant, integrity-significant, and lifecycle-significant.

Only then prepare an explicit schema proposal.

Existing governed JSONB-to-relational promotion remains subject to the owner-approval gate in `SPECIALIZED_APP_JSONB_SCALING_STRATEGY.md`.

---

## 15. Cross-domain certification requirement

A proposed generic capability is not considered validated merely because it solves one manufacturing example.

Before admission, test it against materially different scenarios where relevant, including several of:

- MTS/MTO/ATO/ETO manufacturing;
- batch/repetitive-line/job-shop/continuous/project environments;
- hospital/clinic operations;
- fleet/mobile operations;
- retail;
- ecommerce;
- fluid startup organizations.

The validation question is:

```text
Can the same Process Engine + small reasoning vocabulary +
Effect Library express the scenario by changing metadata/processes,
without domain-specific runtime branches?
```

---

## 16. Development sequence

### Wave 1 — model foundation

1. Consolidate canon and remove contradictory terminology.
2. Refactor the draft calculation code into a small governed reasoning library.
3. Add calculated Macro context with minimal Process Engine changes.
4. Keep decomposition as one consumer rather than the center of reasoning.

### Wave 2 — temporal/resource foundation

1. Define Calendar V1 contract.
2. Define Workstation/Capability V1 contract using existing kernel structures first.
3. Add temporal working-time primitives.
4. Add bounded resource/capability resolution.
5. Validate capacity and forward/backward scheduling composition.

### Wave 3 — orchestration

1. Formalize Service Object routing contract.
2. Separate `process_binding` applicability from inter-process route sequencing.
3. Define process-scheduler behavior and route provenance.
4. Define task/work allocation only where persistent task state is needed.

### Wave 4 — packaging/onboarding

1. Define Profile Pack contract.
2. Build textbook reference packs.
3. Build a fluid/startup reference pack.
4. Add preview/instantiate/customize/provenance workflow.
5. Certify across domains.

---

## 17. UI development boundary

UI implementation may be produced with external design/code-generation tools, but the UI is not an authority for business rules.

UI prompts and designs must consume or reflect governed metadata and must not introduce:

- hardcoded domain process logic;
- hardcoded status catalogs that duplicate dropdown governance;
- hidden tenant-specific behavior;
- process transitions outside the Process Engine;
- direct mutation logic bypassing Effects.

The UI may provide editors/workbenches for Profile Packs, processes, calendars, capabilities, and metadata, but runtime semantics remain governed by the kernel/process architecture.

---

## 18. Drift and quality control

For every implementation wave, compare in this order:

1. this canon and the other architecture MD files;
2. actual migrations/schema;
3. runtime/service code;
4. UI code.

If runtime implementation contradicts the canon, record it explicitly as **implementation drift**. Do not silently rewrite the architecture to match existing code.

Any proposal that changes a canonical boundary must be presented as an architecture change for explicit approval before implementation.

Quality review must explicitly check for:

- domain-specific runtime branches;
- generic-capability explosion;
- Effect explosion;
- uncontrolled JSONB writes;
- unbounded reasoning loops/collections;
- large in-memory candidate scans;
- query paths without indexing strategy;
- duplicate governance catalogs in JS/UI;
- unnecessary new tables;
- Process/Task/Macro/Effect responsibility drift;
- Profile Packs acting as hidden runtime engines.

---

## 19. Immediate next step

The first implementation step after this canon is:

```text
GOVERNED REASONING V1
```

Refactor the existing draft arithmetic/decomposition work into a small domain-neutral reasoning library while preserving the current Process Engine and existing governed Effect behavior.

Before integration into the live runtime, validate the V1 operator set for:

- composition sufficiency;
- bounded execution;
- batch and non-batch manufacturing;
- resource selection;
- hospital/fleet/retail/ecommerce examples;
- compatibility with the temporal/calendar layer that follows;
- query/candidate-set cost under the JSONB scaling guardrails.
