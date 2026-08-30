# EIP Process Engine Calculation Bridge V1

Date: 2026-08-30

Status: Pre-integration contract. Helper implementation is present; `core_process_engine.js` remains unchanged until local regression gates pass.

## 1. Purpose

This slice connects governed Macro reasoning to the existing Process Engine without changing Process semantics, replacing Effect handlers, or introducing a second workflow engine.

Canonical flow remains:

```text
PROCESS INSTANCE
  -> transition
  -> MACRO
  -> bounded parent projection
  -> governed reasoning
  -> $calc context
  -> existing OBJECT_EFFECT handlers
  -> kernel mutation
```

Reasoning is non-mutating. Effects remain the mutation boundary.

## 2. Query-shape rule

A Macro that references Service Object JSONB attributes must not cause the Process Engine to load the complete `service_object.attrs` document.

Example Macro references:

```text
$parent.attrs.quantity
$parent.attrs.production.rate
```

The bridge statically discovers those references and issues one bounded projection query using parameterized JSONB paths.

Target shape:

```text
resolve Macro
-> inspect referenced parent attr paths
-> SELECT only those JSONB paths
-> reconstruct a small parent projection
-> execute governed reasoning
```

The projection is bounded by:

- maximum number of JSONB paths;
- maximum path depth;
- forbidden prototype/path segments;
- one projection query per Macro execution in V1.

This is consistent with `SPECIALIZED_APP_JSONB_SCALING_STRATEGY.md`: query shape and selective projection are preferred before any JSONB-to-relational promotion proposal.

## 3. Calculation context

The helper returns:

```text
calc
calculation audit
calculation digest
referenced parent paths
projection query count
```

Only bounded audit/provenance should be added to Process history. Full calculation payloads must not be copied into growing `process_instance.cursor_json` history.

Effects will eventually resolve:

```text
$calc.required_minutes
$calc.selected_workstation.id
$calc.child_plan
```

using the same recursive dynamic-value resolution already used for `$payload.*` and `$created.*` references.

## 4. No reasoning means no cost

Macros without `reasoning`/`calculations` blocks:

- execute no reasoning runtime;
- issue no parent JSONB projection query;
- produce an empty calculation context;
- preserve current Macro/Effect behavior.

This is required for backward compatibility and to avoid engine overhead on existing processes.

## 5. Work requirement relationship

This bridge does not turn the capacity resolver into a process-duration calculator.

The intended chain remains:

```text
PROCESS / MACRO
  -> governed reasoning
  -> work requirement
  -> eligible workstation
  -> candidate-specific duration where rate-dependent
  -> workstation calendar + reservations
  -> capacity slot
```

A fixed-duration Process can calculate `required_minutes` directly. A rate-dependent Process can carry workload until an eligible Workstation rate is known.

## 6. Current implementation

Implemented:

```text
services/api/src/core/reasoning/processMacroBridge.js
services/api/test/processMacroBridgeV1.test.mjs
```

The helper provides:

- bounded `$parent.attrs.*` projection;
- nested projection reconstruction;
- Macro reasoning execution;
- calculation digest/audit forwarding;
- isolated `$calc.*` reference resolution helper;
- no-query behavior when parent attrs are not referenced;
- no-op behavior when a Macro has no reasoning blocks.

## 7. Deliberately not integrated yet

`core_process_engine.js` is not modified in this commit series.

Before integration, local tests must prove:

1. Wave 1 governed reasoning tests pass;
2. Wave 2 temporal/resource tests pass;
3. Wave 3 work-requirement and route-planner tests pass;
4. Process Macro bridge tests pass;
5. existing API regression suite passes.

After those gates, the Process Engine change must be limited to:

```text
import bridge
resolve Macro
execute bridge
attach bounded ctx.calc
teach existing dynamic reference resolver about $calc.*
apply existing Effects
record digest/audit only
```

No Effect handler replacement, schema migration, new Effect type, or whole-document JSONB fetch is authorized in this slice.

## 8. Drift checks

Reject the integration if it introduces any of the following:

- domain-specific reasoning branch;
- new scheduling/business engine inside `core_process_engine.js`;
- arbitrary metadata execution;
- full `attrs` fetch for reasoning convenience;
- unbounded path/candidate/result expansion;
- storage of full calculated payloads in process history;
- new table or JSONB-to-relational promotion without explicit approval.
