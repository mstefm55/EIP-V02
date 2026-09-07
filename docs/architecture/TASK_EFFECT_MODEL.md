# TASK_EFFECT_MODEL

This document defines the canonical Process -> Task Label -> Macro -> Object_Effect execution model for EIP Core V2.

It must be read together with `KERNEL_CANON.md`, `SERVICE_OBJECT_CANON.md`, `OPERATING_MODEL_CANON.md`, and `EFFECT_LIBRARY_PRIMITIVE_V1.md`.

## Canonical model

1. **Process**: control-flow definition (states/nodes, transitions, guards).
2. **Task label / process semantics**: human/business-facing wording associated with process intent.
3. **Macro**: reusable ordered execution bundle attached to lifecycle intent.
4. **Object_Effect Library**: standardized governed transformations applied to explicit kernel object families.
5. **Object**: the governed runtime object receiving the transformation, including Service Object, Task and Object Link where applicable.

These layers are complementary and must remain separate.

## Task label is not automatically a persisted Task

A Task Label is human/business-facing process wording.

A persisted `eip_core.task` is created only when durable work-management state is required, for example assignment, due date, work queue, blocked state, notes, claim/reassign, or explicit human completion.

Automatic transitions may have task labels without creating persisted Task rows.

A Process Instance and persisted Task may correspond 1:1 operationally in a simple one-action process, but they retain different kernel responsibilities.

## Macro runtime model

- Macro is first-class and governed at runtime through `process_def.graph.macros`.
- Transition execution resolves `macro_code` first, then executes the Macro's governed execution bundle explicitly.
- Process history records Macro provenance and resolved runtime parameters for auditability.
- Transition-level hidden Effect ownership is not allowed.
- Business lifecycle mutation remains under Process/Macro/Effect authority rather than route-local or UI-local logic.

## Governed reasoning inside Macro execution

EIP may calculate or resolve values before Effects execute, but reasoning is non-mutating and does not replace the Process Engine.

Conceptually:

```text
PROCESS / TRANSITION
      -> MACRO
          -> governed calculation/resolution -> result/context
          -> OBJECT_EFFECTS -> kernel mutation
```

Calculated context may supply Effect parameters. Reasoning must remain bounded, declarative, and governed under `OPERATING_MODEL_CANON.md`.

Do not create domain-specific reasoning engines such as MTO, hospital, fleet, batch, retail, or ecommerce engines.

Arithmetic and temporal transformation remain reasoning/resolver concerns. Quantity arithmetic uses the governed operator algebra. Working-date calculation uses the timezone-aware calendar/capacity resolvers. Effects receive already-resolved values such as `$calc.*`, timestamps, durations, quantities, or chosen references and do not perform MRP/scheduling decisions themselves.

## Object_Effect model

Effects are reusable governed transformations applied to explicit kernel object families.

`domain-neutral` does not mean one free-form universal CRUD primitive whose target family is supplied as an arbitrary parameter.

Kernel object boundaries remain explicit in Effect semantics.

### Effect Library Primitive V1 — locked public vocabulary

The audited canonical public vocabulary is defined in `EFFECT_LIBRARY_PRIMITIVE_V1.md` and is:

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

Security-specific kernel Effects remain separate:

```text
ACCESS_GRANT_CREATE
ACCESS_GRANT_PATCH
```

`HTTP_REQUEST` is a governed integration capability, not part of Object_Effect Primitive V1. Integration output must be persisted through the appropriate primitive Object_Effect rather than making the HTTP capability a second mutation catalogue.

The public primitive library must not regain business-semantic codes such as `INVENTORY_MOVE`, `INVENTORY_CONSUME`, `INVENTORY_PRODUCE`, `INVENTORY_CONVERT`, or `VARIANT_INVENTORY_VALIDATE`.

The exact executable compatibility codes may temporarily differ while historical aliases are retired, but public metadata authority belongs to the locked vocabulary above.

### Semantic atomicity

One Effect may execute multiple internal functions or database statements when all operations implement one coherent indivisible transformation and preserve a kernel invariant.

Examples:

- a state transition may validate, lock, update state, and write mandatory status history;
- creation may validate required kernel invariants and insert one governed object atomically;
- a bounded link patch may update relationship metadata while preserving relationship identity.

An Effect must not combine independent externally meaningful transformations merely for convenience.

Multi-child creation, relationship creation plus unrelated mutation, quantity planning, allocation decisions, integration storage, or similar sequencing belongs in a Macro composed from primitives.

## What must not become Effects

Business calculations, decisions, orchestration, and domain semantics belong to Process/Macro reasoning rather than the Effect vocabulary.

Do not create Effects such as:

```text
MTO_PLAN
MRP_RUN
ALLOCATE_MATERIAL_FOR_ORDER
ASSIGN_HOSPITAL_BED
SELECT_TRUCK
REPLENISH_STORE
RUN_PRODUCTION_LINE
ORDER_CONFIRM
INVENTORY_MOVE
INVENTORY_CONSUME
INVENTORY_PRODUCE
INVENTORY_CONVERT
VARIANT_INVENTORY_VALIDATE
```

These are compositions of process semantics, governed reasoning, resolvers and generic Object_Effects.

## Child Service Object rule

A child is a normal Service Object row, not an embedded JSONB child record.

Parent/child relationships use governed relationships such as `object_link`.

Create a child Service Object only when the child requires durable independent identity or lifecycle such as routing, state, genealogy, assignment, scheduling, quality control, completion, or audit.

Arithmetic decomposition alone does not justify a child object.

A canonical `SERVICE_OBJECT_CREATE` Effect creates one governed Service Object. If a business decomposition requires several children and relationships, the Macro composes repeated `SERVICE_OBJECT_CREATE` and `LINK_CREATE` operations rather than hiding the decomposition inside one specialized Effect identity.

## Service Object patch boundary

`SERVICE_OBJECT_PATCH` owns bounded non-lifecycle mutation of one Service Object. Its frozen V1 scope is:

```text
code
title
owner_agent_id
bounded attrs SET/REMOVE paths
```

`status` is not patchable and belongs to `SERVICE_OBJECT_STATE_TRANSITION`. `object_type` is not patchable by this primitive. Free-form attrs merge is not part of the canonical contract.

## Object Link patch boundary

`LINK_PATCH` updates only governed relationship metadata (`object_link.attrs`) using bounded `SET` / `REMOVE` paths. The relationship identity (`src_kind`, `src_id`, `dst_kind`, `dst_id`, `relation_type`) is supplied as the selector and cannot be changed by the patch Effect.

This lets materially different domains update relationship facts such as allocation quantity or effective dates without inventing business Effects or deleting/recreating the relationship.

## Effect governance

- Effect catalog authority is anchored in governed metadata such as `PROCESS_EFFECT_TYPE`.
- Governed metadata resolves the canonical executable identity through `canonical_effect_code`; aliases may point to that canonical code but may not redefine executable semantics.
- Runtime dispatch handlers remain code-owned, finite, and reviewed.
- Metadata may activate/deactivate, alias, version, or constrain an Effect contract, but may not execute arbitrary code.
- Every active canonical Effect must have runtime coverage and parameter validation.
- Deprecated aliases may remain for bounded compatibility, but they are not public primitive authority and may not acquire broader business semantics.
- Unknown or inactive Effects fail closed.
- Unsupported parameters must fail closed once the canonical runtime contract is enforced.

## Runtime resolution rule

- API/service layer resolves governed metadata, tenant context, and concrete values.
- Reasoning/resolver code produces bounded calculated results without mutating kernel state.
- Effects receive already governed/resolved parameters and perform explicit transformations.
- Field headers used for validation and full-structure assembly come from governed metadata and approved contracts.
- Routes expose transport endpoints; they must not become hidden workflow engines.
- Service Object type/category governance uses dropdown/field metadata rather than route-local or UI-local catalogs.
- Document governance stays kernel-aligned through Service Objects plus governed document metadata, not hardcoded module logic.
- Calendar, capacity and scheduling logic remain non-mutating resolvers. Persisting a calculated schedule uses a primitive patch/state Effect after calculation.

## Anti-explosion rules

### Anti-task-explosion

Do not multiply bespoke Task definitions for every business variant. Create persisted Tasks only when durable task/work-management state is needed.

### Anti-effect-explosion

Do not add a new Effect when the requirement is a Process/Macro composition of existing Object_Effects.

### Anti-generic-capability-explosion

Do not add a new reasoning primitive when the requirement can be expressed cleanly from a small composition of existing primitives.

## Primitive expansion gate

Effect Library Primitive V1 is frozen as a public vocabulary by the forward freeze migration `v2_0038_effect_library_primitive_v1_freeze.sql`. Adding a new canonical primitive requires the full primitive-admission test recorded in `EFFECT_LIBRARY_PRIMITIVE_V1.md`, including cross-domain reuse, explicit object-family scope, bounded parameters, generic handler identity, Process/Macro separation, governed metadata admission and fail-closed tests.

## Drift rule

Legacy executable codes in the current implementation may temporarily differ from the canonical Object_Effect naming direction.

That difference is implementation debt/transition state, not authority to redefine the architecture.

When implementation and this document conflict, record the difference explicitly as implementation drift and resolve it through an approved forward migration/refactor rather than silently changing the canon.
