# Process Studio Backend Gap Audit — 2026-09-12

Branch audited: `feature/route-temporal-gate-v1` at `b9eb19355cbc54ebe86cec833bfc8b7476daf369`

Purpose: prepare EIP Core V2 for later integration of the Process Studio UI being developed separately in Google AI Studio. This audit does not modify that WIP UI.

## Summary

The backend is not starting from zero. Process Studio already has a substantial governed runtime surface. The remaining work is primarily lifecycle/tenant-contract hardening and adapter stabilization, not another Process Engine.

| Area | Status | Evidence / action |
| --- | --- | --- |
| Process catalogue | READY | `/process/workbench/catalog` projects graph summaries, task labels, macros, effect references and runtime counts |
| Process detail | READY | `/process/workbench/defs/:id` returns definition + task templates + bindings + recent instances |
| Draft create/update | PARTIAL | create/update routes exist; explicit immutable-published semantics not yet enforced |
| Validation | READY / SHAPE GAP | server validation exists and covers graph/macro/effect/task-template governance; response is still a string error list |
| Publish | PARTIAL | validation-before-publish exists; publish currently mutates the same row in place |
| Draft revision | GAP | no canonical `published -> new draft version` operation yet |
| Runtime version pinning | READY | `process_instance.process_def_id` pins the exact definition row |
| Runtime published-only selection | GAP | explicit ID/code and binding resolution do not consistently require published lifecycle state |
| Process tenant default | READY | legacy routes default to authenticated `session.tenant_id` |
| Raw tenant override | GAP | several legacy Process routes still accept browser `tenant_id` UUID input |
| Task templates | READY | governed CRUD/list contracts exist and validation resolves human-task references |
| Bindings | READY | governed process-binding contracts exist |
| Operator runtime | READY | instances can be listed, loaded, started and advanced through Process Engine routes |
| Effect catalogue | READY | effect authority is `PROCESS_EFFECT_TYPE`; macros reference governed effects |
| Inline transition effects | CLOSED | validator rejects inline transition effect bundles |
| Reasoning runtime | READY FOUNDATION | governed reasoning/macro bridge exists; Studio authoring adapter still needs formal transport mapping |
| UI Studio backend foundation | READY FOUNDATION | `ui_surface` + code-owned renderer/primitive registry already exist; Studio lifecycle adapter still needs formal mapping |
| New Process table | NOT REQUIRED | existing versioned `process_def` and related governed structures are sufficient for V1 |

## Findings

### 1. Existing Process authoring projection is strong

`buildProcessWorkbenchProjection(...)` already derives a Studio-friendly projection from `process_def.graph` and `attrs`, including:

- nodes;
- transitions;
- task labels;
- macro summaries;
- canonical effect references;
- object type/category;
- module;
- publication flag;
- graph summary counts.

`loadProcessWorkbenchCounts(...)` adds task-template, binding, total-instance and active-instance counts.

This should be reused by the Google adapter rather than rebuilding the same interpretation in React.

### 2. Validation authority already belongs to EIP

`validateProcessGraph(...)` already validates major canonical rules:

- graph/initial node;
- node and edge taxonomy;
- process actions;
- transition macro references;
- inline effect prohibition;
- macro effect contracts;
- router/join topology;
- cycles;
- Service Object type/category governance;
- document governance;
- human-task template references.

Therefore Google Studio validation should be optimistic/presentational only; publish must continue to use server validation.

### 3. Published rows are not immutable yet

Current `PATCH /process/defs/:id` updates graph/attrs/name on the selected row regardless of publication state.

Current `POST /process/defs/:id/publish` validates then changes `attrs.is_published=true` on that same row.

Target:

```text
draft vN -> validate -> publish vN (immutable)
published vN -> create draft revision vN+1 -> edit -> validate -> publish
```

The new lifecycle helper on `prep/process-studio-integration-v1` defines this target without schema expansion.

### 4. Runtime does not yet fail closed on draft definitions

`createInstance(...)` can resolve Process Definitions by:

- explicit `process_def_id`;
- process code/version;
- `process_binding`.

The current lookups require tenant scope and, for binding resolution, active status, but do not consistently require published lifecycle state.

This must be corrected before Google Studio can create real drafts safely; otherwise a saved-but-unpublished draft could become executable.

### 5. Runtime pinning itself is already correct

A Process Instance stores the selected `process_def_id` and later advancement reloads that exact definition ID.

That means once published-only selection is enforced, the architecture already supports:

```text
instance started on v1 -> stays on v1
publish v2 -> new instances may select v2
```

No new snapshot table is required for this aspect.

### 6. Browser tenant UUID should disappear from the Studio adapter

Legacy Process routes accept optional `tenant_id` values and compare them with the session tenant. This is fail-closed for cross-tenant access, but the Google Studio adapter should not depend on that field.

First integration contract:

```text
Studio browser -> authenticated session -> session tenant
```

If Owner Admin later needs cross-tenant Process Studio selection, use a server-provided tenant-code/handle catalogue and server resolution, not a raw UUID field.

## Prep branch changes

The preparation branch adds:

- `docs/architecture/PROCESS_STUDIO_INTEGRATION_CONTRACT_V1.md`
- `services/api/src/services/process/processDefinitionLifecycle.js`
- `services/api/src/services/process/processStudioTransportContract.js`
- lifecycle unit tests;
- transport-contract unit tests.

These additions intentionally do not modify the Google AI Studio WIP or deploy a new Process UI.

## Next backend closure sequence

1. Wire lifecycle helper into Process Definition create/update/publish paths.
2. Add canonical `create draft revision` operation using existing `process_def` rows.
3. Block mutation of published/archived definitions.
4. Enforce published-only runtime selection for explicit ID/code/binding resolution.
5. Preserve already-started instances by exact `process_def_id`.
6. Add structured validation issue projection while preserving canonical error codes.
7. Add session-owned Studio-facing tests that never send `tenant_id`.
8. Run complete API/security/tenant/process governance gates.
9. Only then map the accepted Google WIP mock adapter to EIP transport.

## Freeze rule

Do not import or rewrite the Google AI Studio Process Studio while its UI work is active. Backend preparation and UI visual development remain parallel streams until adapter cutover.
