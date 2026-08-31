# EIP Execution and Route Canon

Date: 2026-08-31

Status: Canonical architecture guardrail approved for EIP Core V2 operating-model development.

This document clarifies the responsibility split between governed business semantics, routing, reasoning, process execution, Effects, persistence, time, resources and audit. It must be read with `OPERATING_MODEL_CANON.md`, `TASK_EFFECT_MODEL.md`, `TEMPORAL_RESOURCE_V1.md`, and the Wave 3 orchestration contracts.

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
  = Process Engine resolving Macro intent into governed Effects

WHERE
  = the appropriate kernel persistence structures: relational tables and governed JSONB according to lifecycle, integrity and query requirements

WHEN
  = temporal/scheduling resolution using governed calendars, dependencies, working time, capacity and scheduling policy

WHO / WITH WHAT
  = governed agents, workstations/resources, capabilities and assignments

WHY
  = process history, reasoning/provenance audit, route provenance and decision source
```

These are responsibility boundaries, not separate domain engines.

---

## 2. `HOW` refinement: Process Engine, Macro and Effects

The Effect Library does not decide business workflow and the Process Engine does not contain hardcoded domain operations.

The execution chain is:

```text
Process Definition / transition
  -> Macro
  -> governed reasoning/resolution as needed
  -> Effects
  -> kernel objects
```

The Process Engine orchestrates one Process Instance and resolves the governed Macro for a transition.

The Macro expresses the ordered execution intent.

Effects are the governed mutation boundary. They create, patch, transition, link or otherwise transform explicit kernel object families.

Therefore `HOW = Process Engine + Macro + Effect Library`, not the Effect Library acting as a workflow engine by itself.

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

This remains a V1 implementation choice, not a permanent declaration that route persistence can never become relational.

---

## 4. `WHEN` refinement: calendar truth versus scheduling decision

A calendar answers questions such as:

- is this instant working time?;
- what is the next/previous working instant?;
- how much working time exists between two instants?;
- what working intervals are available after exceptions/overrides?

The scheduler/temporal resolver uses that calendar truth together with route dependencies, earliest/latest dates, required duration, reservations, capacity and policy to determine whether a route step may start now and, if not, when it becomes eligible.

Therefore:

```text
Calendar = working-time truth
Scheduler/temporal resolver = start/finish eligibility decision
```

Completion of one route step does not by itself authorize immediate start of the next step.

---

## 5. Service Object route ownership

When a Service Object is created or otherwise reaches the governed trigger for route initialization, EIP resolves the applicable route once, snapshots the explicit Process Definition identities/versions and governed route provenance, and stores the result on the Service Object.

Plain-English flow:

```text
Service Object created/triggered
  -> discover bounded candidate processes
  -> resolve which apply
  -> order them using governed route metadata
  -> pin Process Definition versions
  -> persist route snapshot on Service Object
  -> orchestrate that saved route
```

The orchestrator follows the saved route. It does not rediscover/rebuild the route after each completed Process Instance.

A deliberate route migration is the mechanism for changing an in-flight Service Object to a newly published route.

---

## 6. Route progression

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
current Process Instance completes
  -> corresponding saved route step becomes COMPLETED
  -> identify next eligible saved route step
  -> evaluate temporal/resource eligibility
  -> start now if eligible
     OR remain waiting until eligible
  -> bind/reuse Process Instance
  -> persist updated route snapshot
```

V1 retains one active inter-process route step at a time unless a separately approved cross-domain requirement justifies parallel route orchestration.

---

## 7. Route publication and version behavior

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

## 8. Route migration

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

---

## 9. No hardcoded business `what`

Runtime code may implement generic mechanics such as:

- bounded route loading;
- version pinning;
- state transitions;
- temporal eligibility checks;
- candidate limits;
- idempotency;
- transaction/locking behavior;
- generic reasoning execution;
- Effect dispatch.

Runtime code must not contain tenant/domain branches such as:

```text
if sales order then approval
if hospital then triage
if manufacturing then production
if ecommerce then shipment
```

Those belong in governed Process Definitions, metadata, Profile Packs, policies and reasoning inputs.

---

## 10. Architecture consequence for current Wave 3 runtime

Any current runtime behavior that immediately starts the next route step solely because the previous Process Instance completed is incomplete relative to this canon.

The required correction is a generic temporal eligibility gate between route-step completion and next-process start. The gate must compose the existing calendar/temporal/resource primitives rather than introducing domain-specific schedulers.

This is implementation alignment work, not a reason to change the canonical architecture.
