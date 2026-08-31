# EIP Route Applicability V1

Date: 2026-08-31

Status: Wave 3 implementation contract under `OPERATING_MODEL_CANON.md`, `EXECUTION_AND_ROUTE_CANON.md`, `ORCHESTRATION_V1.md`, `ROUTE_INITIALIZATION_V1.md`, and the existing governed reasoning runtime.

## 1. Purpose

Route Initialization V1 can already find candidate Process Definitions, order them explicitly, persist a route, and start the first Process Instance. This slice adds the missing per-case decision: determine whether each candidate Process Definition actually applies to the current Service Object by reusing EIP's existing governed reasoning algebra.

Plain-English flow:

```text
business object
  -> find candidate processes for this type of object
  -> evaluate a governed yes/no rule for each candidate when one is defined
  -> remove candidates whose result is false
  -> order the remaining candidates
  -> save the route
  -> hand the saved route to orchestration
```

No new condition language or business-specific operator is introduced.

## 2. Applicability metadata

A Process Binding may carry a bounded declarative applicability expression inside its existing route metadata:

```json
{
  "route_v1": {
    "step_code": "REVIEW",
    "sequence": 200,
    "applicability": {
      "expression": {
        "op": "GTE",
        "args": [
          { "ref": "$parent.attrs.total_amount" },
          1000
        ]
      }
    }
  }
}
```

This is not arbitrary executable code. The expression is evaluated only by the existing governed reasoning runtime and therefore inherits its finite operator vocabulary and execution limits.

V1 deliberately supports a single applicability `expression`. It does not add a second program/workflow model inside routing. If future cross-domain evidence requires a richer bounded reasoning program, that must be reviewed separately rather than assumed now.

## 3. Allowed reasoning roots

Applicability expressions may read only the existing governed reasoning roots:

```text
$parent
$policy
$context
$input
```

Typical use is:

```text
$parent.attrs.<governed attribute>
```

Route applicability does not introduce `$calc`, database access, network access, arbitrary imports, JavaScript evaluation, or direct SQL authored in metadata.

The result must be exactly boolean:

```text
true  -> candidate may enter the route
false -> candidate is removed from this route
```

Any non-boolean result fails closed.

## 4. Selective Service Object projection

Applicability must not fetch the complete Service Object `attrs` document merely because one or more rules reference a few fields.

Before evaluation, the resolver statically inspects all candidate applicability expressions and gathers only referenced paths such as:

```text
$parent.attrs.total_amount
$parent.attrs.priority_code
```

It then performs one bounded projection query for the union of required paths.

Conceptually:

```sql
SELECT
  attrs #> '{total_amount}',
  attrs #> '{priority_code}'
FROM eip_core.service_object
WHERE tenant_id=? AND id=?
```

Actual paths remain parameterized. The full `attrs` payload is not selected.

If no applicability expression references parent attributes, no applicability projection query is executed.

## 5. Bounds

V1 defaults:

```text
maximum distinct projected parent attr paths: 64
maximum parent attr path depth:              8
```

Hard caps:

```text
maximum distinct projected parent attr paths: 256
maximum parent attr path depth:               16
```

Unsafe prototype-path segments are rejected.

The existing governed reasoning runtime continues to enforce expression depth, step count, iteration, emit, and collection bounds.

## 6. Default and externally resolved applicability

If a candidate has no applicability expression, it remains applicable by default unless static route metadata disables it.

Route Initialization continues to accept an explicitly supplied `applicabilityByBindingId` map for callers that already resolved applicability through another governed path. When that map is explicitly supplied, Route Initialization uses it rather than evaluating the binding expressions again.

This preserves one decision boundary and avoids duplicate evaluation.

## 7. Separation of responsibilities

The boundary remains:

```text
PROCESS BINDING
  -> bounded candidate discovery

GOVERNED REASONING
  -> case-specific yes/no applicability

ROUTE PLANNER
  -> ordering/version-pinned snapshot

ROUTE COORDINATOR/RUNTIME
  -> progress through the saved route subject to temporal/resource eligibility

PROCESS ENGINE
  -> executes each Process Instance through Macro + governed Effects
```

The route planner itself does not evaluate business conditions.

## 8. Resolution timing and migration boundary

Applicability is resolved when a Service Object is first assigned its governed route, normally at creation or another explicit route-initialization trigger.

The resulting applicable, ordered and version-pinned route is persisted on the Service Object and becomes the orchestration authority for that object.

The route is not re-resolved after every Process Instance completion.

If route definitions or applicability policy later change:

```text
new Service Objects
  -> resolve against the current published route/policy

in-progress Service Objects
  -> remain pinned to their existing saved route by default
  -> may move only through explicit governed route migration

completed Service Objects
  -> retain their completed saved route unchanged
  -> are not route-migration candidates
```

This preserves historical truth and prevents silent mid-lifecycle rule changes.

## 9. Audit/provenance

Applicability resolution returns bounded audit metadata containing:

- binding identity;
- decision source;
- boolean result;
- reasoning step/emit counts where reasoning executed;
- digest of the applicability expression;
- digest of the aggregate applicability audit;
- projected parent paths;
- projection query count.

The raw Service Object values used by the rule are not copied into route audit merely for convenience.

Route migration, when later implemented, must preserve previous/new route provenance and must not rewrite completed route history.

## 10. No architecture expansion

This slice adds:

```text
new tables               0
new migrations           0
new Effects              0
new reasoning operators  0
new condition languages  0
Process Engine changes   0
```

It composes the existing Process Binding, governed reasoning runtime, route planner, route persistence, and route lifecycle runtime.

## 11. Examples

A high-value review step can be expressed generically as:

```text
GTE($parent.attrs.total_amount, 1000)
```

A priority-specific step can be expressed as:

```text
EQ($parent.attrs.priority_code, "urgent")
```

The same algebra can represent materially different domains without introducing business primitives such as `HIGH_VALUE_ORDER_REVIEW`, `PATIENT_TRIAGE_ROUTE`, or `EXPEDITE_SHIPMENT` into the core runtime.
