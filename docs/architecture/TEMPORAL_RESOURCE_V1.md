# EIP Temporal and Resource Foundation V1

Date: 2026-09-01

Status: Wave 2 implementation contract under `OPERATING_MODEL_CANON.md`.

## 1. Purpose

Wave 2 adds a small generic temporal/resource foundation without creating a scheduling domain engine and without adding new persistence tables.

The Process Engine remains unchanged conceptually:

```text
PROCESS -> TASK LABEL / STEP -> MACRO -> governed reasoning/resolution -> OBJECT_EFFECT -> OBJECT
```

This wave provides pure/bounded calculation functions that are invoked from Macro reasoning context. They are tools used by governed Processes such as Planning/Scheduling; they are not peer workflow engines and they do not belong inside route orchestration.

## 2. No schema expansion in V1

Calendar, workstation, capability and capacity contracts are represented as governed projections/metadata inputs for V1. No `calendar`, `workstation`, `capacity`, `schedule`, or domain-specific table is introduced by this wave.

A relational structure may be proposed later only if usage proves that existing kernel structures and governed metadata cannot provide required integrity/query performance. Existing JSONB-to-relational promotion remains owner-controlled under `SPECIALIZED_APP_JSONB_SCALING_STRATEGY.md`.

## 3. Calendar V1 contract

A calendar resolver consumes one or more layers sharing the same IANA timezone.

Example:

```json
{
  "timezone": "Indian/Mauritius",
  "weekly": {
    "MONDAY": [{"start":"08:00","end":"17:00"}],
    "TUESDAY": [{"start":"08:00","end":"17:00"}]
  },
  "exceptions": [
    {"date":"2026-01-01","closed":true},
    {"start_date":"2026-08-01","end_date":"2026-08-21","closed":true},
    {"date":"2026-12-24","intervals":[{"start":"08:00","end":"13:00"}]}
  ]
}
```

Rules:

- a layer with no `weekly` pattern is unconstrained 24/7 except its explicit exceptions;
- a layer with a `weekly` pattern treats omitted weekdays as closed;
- effective availability is the intersection of all active layers;
- later matching exceptions inside one layer override earlier entries;
- work intervals are day-bounded in V1; overnight shifts are represented as two intervals on adjacent local dates;
- `24:00` is allowed only as an interval end;
- all layers must use the same timezone for one resolution call.

V1 supports public holidays, weekends, seasonal shutdowns, partial-day overrides, maintenance/leave overrides and resource-specific calendars by composition.

## 4. Temporal V1 operations

Implemented:

```text
IS_WORKING_INSTANT
NEXT_WORKING_INSTANT
PREVIOUS_WORKING_INSTANT
ADD_WORKING_TIME
SUBTRACT_WORKING_TIME
WORKING_TIME_BETWEEN
```

The code exposes these through JavaScript functions rather than expanding the generic arithmetic operator catalog. This deliberately avoids capability explosion. They are temporal calculation capabilities with calendar context, not scalar Math operators and not independent workflow engines.

DST spring transitions are calculated using actual UTC elapsed time across local calendar intervals. Ambiguous repeated local times during a fall-back transition require an explicit disambiguation policy before full production scheduling certification.

## 5. Capacity slot V1

`resolveCapacitySlot` searches an effective calendar while subtracting bounded busy reservations.

Inputs include:

```text
calendar layers
anchor instant
duration minutes
FORWARD | BACKWARD
allow_split
busy reservations
bounded search limits
```

It can return a contiguous slot or a set of chronological segments when splitting is explicitly allowed.

This is a generic calculation primitive. It does not know about production lines, operating theatres, vehicles, stores or warehouses.

Its normal architectural consumer is governed Process/Macro reasoning, including Planning/Scheduling logic. Route orchestration must not call it to invent or recalculate a route schedule.

## 6. Workstation projection V1

A Workstation remains a governed execution capability composed from existing resources, not a new table in this wave.

A resolver consumes bounded candidate projections with fields such as:

```text
id
capabilities[]
mobility
capacity{}
calendar_layers[]
reservations[]
```

Eligibility can require:

```text
all capabilities
any capability
mobility
minimum generic capacity dimensions
```

The same resolver is validated against manufacturing, hospital and fleet projections.

Persistence-side candidate queries must prefilter/index candidate sets before these JavaScript resolvers run. Loading all tenant resources and filtering them in memory violates the engine-load rule.

## 7. Macro calculation bridge contract

The Process Engine bridge exposes governed Macro reasoning results to Effects through `$calc.*`.

A Macro may contain:

```json
{
  "reasoning": [
    {
      "as": "required_hours",
      "expression": {
        "op":"DIVIDE",
        "args":[{"ref":"$parent.attrs.quantity"},{"ref":"$input.rate"}]
      }
    }
  ],
  "effects": []
}
```

Reasoning blocks execute sequentially and later blocks can consume earlier results through governed calculation context.

The canonical execution order is:

```text
Process step / transition
  -> Macro
      -> reasoning / calculation / decision resolution
      -> $calc
      -> ordered Effects using resolved values
  -> resulting output/state
```

## 8. JSONB query guardrail for Macro reasoning

The Process Engine must not fetch the entire `service_object.attrs` payload merely because reasoning can reference `$parent.attrs.*`.

`collectMacroParentAttrPaths(macro)` statically identifies referenced paths. Integration should use those paths to build a bounded JSONB projection query so only required values are loaded.

Target pattern:

```text
inspect Macro refs
-> bounded/index-aware persistence projection
-> small parent projection
-> reasoning
-> $calc context
-> existing Effects
```

History should store reasoning audit/digests and bounded provenance, not arbitrary full calculation payloads that can bloat `process_instance.cursor_json`.

## 9. Known V1 boundaries

Not included yet:

- full finite-capacity multi-operation optimization;
- sequence-dependent setup optimization;
- geospatial routing solver;
- calendar persistence schema;
- workstation persistence schema;
- automatic profile installation;
- DST fall-back repeated-local-time disambiguation policy;
- full Planning/Scheduling process model and accepted-schedule Effect integration;
- IBP/S&OP process layering;
- advanced freeze/unfreeze, planning-horizon and emergency-rescheduling policies.

These omissions are deliberate boundaries, not missing domain engines.

The route runtime is specifically **not** the missing scheduler. Scheduling remains a governed subprocess of Planning that composes these generic temporal/resource functions and persists its accepted output to the Service Object route.

## 10. Quality gates before broader Planning/Scheduling integration

1. all existing `governedReasoningV1` tests pass;
2. all temporal/resource tests pass;
3. all existing API tests pass;
4. no new tables/migrations are added without schema justification/owner approval;
5. no existing Effect handler is replaced merely to introduce scheduling semantics;
6. no whole-document JSONB fetch is introduced for reasoning;
7. candidate/resource resolution stays bounded;
8. reasoning audit is bounded and digest-based;
9. route orchestration consumes persisted schedule rather than recalculating it;
10. normal Planning-cycle scheduling and emergency rescheduling converge on the same governed Scheduling process.
