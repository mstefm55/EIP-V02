# Process Studio Integration Contract V1

Date: 2026-09-12
Status: integration-preparation contract

## 1. Purpose

This contract prepares EIP Core V2 to receive the Process Studio UI being developed separately in Google AI Studio.

The Google project is an authoring client. EIP remains the runtime and governance authority.

This contract deliberately does not import, rewrite, or duplicate the Google UI while it is still under active visual development.

## 2. Fixed authority boundary

```text
Google Process Studio UI
  -> Studio transport adapter
  -> EIP governed API contracts
  -> Process / UI / Reasoning engines
  -> kernel objects
```

The frontend may author and preview metadata. It must not become authority for:

- tenant identity;
- permissions;
- publication state;
- process execution;
- effect execution;
- reasoning execution;
- Service Object lifecycle;
- Process Instance lifecycle;
- UI primitive allowlisting.

No arbitrary JavaScript, executable metadata, raw CSS authority, or direct database contract is admitted.

## 3. Studio areas

The integration target is one Studio family with distinct responsibilities.

| Studio | Responsibility | EIP authority |
| --- | --- | --- |
| Library | reusable/versioned definitions | `process_def`, governed metadata, future reusable catalogue projections |
| Process Studio | process graph, task labels, macros, task templates, bindings | Process Definition + Process Engine contracts |
| Operator Studio | running instances, tasks, operational actions/history | Process Instance / Task runtime APIs |
| Effect Studio | governed effect catalogue and macro composition | `PROCESS_EFFECT_TYPE` + Process Engine handler registry |
| Reasoning Studio | governed rule/resolution authoring and preview | governed reasoning engine and metadata |
| UI Studio | governed UI composition | `ui_surface`, UI renderer/registry, shell profile references |

No Studio owns a second workflow engine.

## 4. Tenant authority

The Google adapter MUST NOT send a raw `tenant_id` UUID as authority.

For the first integration cut, Process Studio operates in the authenticated session tenant. Existing process routes already default to `session.tenant_id` when no tenant override is supplied.

Therefore the production adapter contract is:

```text
browser request
  -> authenticated EIP session
  -> server resolves session tenant
  -> tenant-scoped query / transaction
```

If a later Owner Admin cross-tenant Studio selector is required, it must use a server-provided tenant code/handle allow-list and server-side resolution, following the Connections control-plane pattern. Raw browser UUID authority remains forbidden.

## 5. Process Definition lifecycle

The Studio lifecycle is fixed as:

```text
DRAFT -> VALIDATED -> PUBLISHED -> ARCHIVED
```

`VALIDATED` is a validation result, not a separately mutable persisted business state.

Persisted lifecycle states are:

- `draft`
- `published`
- `archived`

Compatibility metadata may continue to expose `attrs.is_published`, but `attrs.lifecycle_status` becomes the explicit lifecycle projection for Studio integration.

Rules:

1. A newly authored Process Definition is a draft.
2. Drafts are mutable.
3. Publish requires server-side full validation.
4. A published version is immutable.
5. Editing a published definition creates a new draft version; it does not mutate the published row.
6. Process Instances remain pinned to the exact `process_def_id` they started with.
7. Runtime/binding resolution must never silently select a draft once lifecycle enforcement is enabled.
8. Archiving prevents new runtime selection but does not invalidate historical Process Instances.

No new lifecycle table is required for V1. Existing `process_def` version rows + governed attrs are sufficient.

## 6. Current route inventory for the adapter

The Google transport adapter can initially map to existing EIP contracts without sending `tenant_id`.

### Library / Process Studio

- `GET /api/eip/process/workbench/catalog`
- `GET /api/eip/process/workbench/defs/:id`
- `POST /api/eip/process/defs`
- `PATCH /api/eip/process/defs/:id`
- `POST /api/eip/process/defs/:id/validate`
- `POST /api/eip/process/defs/:id/publish`
- `GET/POST/PATCH /api/eip/process/task-templates...`
- `GET/POST/PATCH /api/eip/process/bindings...`
- `GET /api/eip/process/taxonomy`

### Operator Studio

- `GET /api/eip/process/instances`
- `GET /api/eip/process/instances/:id`
- `POST /api/eip/process/instances`
- `POST /api/eip/process/instances/:id/advance`
- task/runtime routes already owned by the Process Engine contract

### Effect Studio

- effect catalogue from governed taxonomy `PROCESS_EFFECT_TYPE`
- effect execution remains internal to Process Engine macro execution
- frontend may compose macro/effect metadata but never register executable handlers

### Reasoning Studio

- consume the existing governed reasoning service/metadata contracts
- preview/evaluate through server-owned reasoning functions
- do not embed a second rule engine in React

### UI Studio

- consume the existing governed UI surface catalogue/detail contracts
- author metadata tree only
- primitive choices must come from the code-owned allowlisted registry/capability contract
- shell/theme is referenced, not embedded as arbitrary CSS

## 7. Required Studio adapter interface

The Google project should be able to replace its mock transport with an injected adapter implementing this conceptual interface:

```text
listProcesses(filters)
getProcess(id)
createProcessDraft(input)
updateProcessDraft(id, patch)
validateProcess(id)
publishProcess(id)
createDraftRevision(id)

listTaskTemplates(processDefId)
createTaskTemplate(input)
updateTaskTemplate(id, patch)

listBindings(processDefId)
createBinding(input)
updateBinding(id, patch)

listProcessInstances(filters)
getProcessInstance(id)
startProcess(input)
advanceProcess(id, action)

listEffectTypes()
listReasoningCapabilities()
evaluateReasoningPreview(input)

listSurfaces(filters)
getSurface(code)
createSurfaceDraft(input)
updateSurfaceDraft(id, patch)
validateSurface(id)
publishSurface(id)
```

The adapter must be transport-only. It must not reproduce EIP validation or permission logic.

## 8. Unified Process validation contract

Production Process Studio needs one authoritative server validation result for the complete five-layer model:

```text
Process Definition
  -> Task Label
  -> Macro
  -> Effect
  -> Service Object / category parameters
```

The existing process validator already checks major structural rules including:

- initial node;
- governed node and edge types;
- transition actions;
- macro existence;
- prohibition of inline transition effects;
- governed effect types/required parameters;
- router/join rules;
- cycle detection;
- governed Service Object/document metadata;
- required task-template references.

For Studio integration, validation responses should be projected into a stable issue shape while preserving machine-readable codes, e.g.:

```json
{
  "valid": false,
  "issues": [
    {
      "code": "TRANSITION_MACRO_REQUIRED",
      "location": "transition:review->approve",
      "message": "Select a macro."
    }
  ]
}
```

Friendly messages are a presentation concern. The server remains validation authority.

## 9. Runtime version pinning

`process_instance.process_def_id` is the immutable runtime reference for an in-flight instance.

The Studio must never replace that reference when a later Process Definition version is published.

The expected lifecycle is:

```text
Process A v1 published
  -> Instance X starts on v1

Process A v2 draft
  -> validate
  -> publish

Instance X remains on v1
new instances resolve v2
```

This is consistent with the orchestration canon requirement that in-flight work does not silently adopt later definitions.

## 10. Google WIP integration rules

While the Google AI Studio project is still under development:

- do not import it into `apps/workbench-ui`;
- do not modify its React/CSS from the EIP backend preparation branch;
- do not mirror its localStorage/mock persistence in EIP;
- do not expose database schema details to its components;
- do not make EIP depend on its mock DTOs.

When UI work is accepted, integration is performed only through the transport/model boundary.

The production adapter must fail closed if EIP transport is unavailable. It must never silently fall back to mock enterprise data.

## 11. Known backend gaps to close before adapter cutover

The current EIP backend already supplies most Process Studio data/runtime contracts, but these items must be closed before the Google UI is connected:

1. **Raw tenant override remains accepted by legacy Process authoring routes.**
   - Google adapter will not use it.
   - new Studio-facing contracts must be session-owned or safe-handle resolved.

2. **Published Process Definitions are currently mutable through the generic PATCH route.**
   - published versions must become immutable;
   - edits must create a new draft revision.

3. **Runtime resolution does not yet consistently require published lifecycle state.**
   - explicit ID/code/binding resolution must fail closed against draft/archived definitions once lifecycle migration is applied.

4. **`is_published` is currently a compatibility boolean rather than a complete lifecycle contract.**
   - normalize to explicit `lifecycle_status` while preserving compatibility reads.

5. **Studio validation response is string-list based.**
   - add a stable machine-readable issue projection without replacing canonical validation codes.

These are backend integration-preparation tasks. They do not require changes to the Google UI.

## 12. No-new-table decision

No new table is justified for Process Studio V1 preparation.

Existing governed structures are sufficient:

- `eip_core.process_def`
- `eip_core.process_binding`
- `eip_core.task_template`
- `eip_core.process_instance`
- `eip_core.task`
- governed dropdown metadata
- `eip_core.ui_surface`
- existing reasoning structures

Schema expansion is deferred unless a later integrity/query requirement cannot be expressed safely with these structures.

## 13. Integration acceptance target

Before replacing the Google mock adapter, EIP backend acceptance must prove:

```text
create draft
-> edit graph/task/macro/effect metadata
-> validate
-> publish immutable version
-> create new draft revision
-> old published version remains unchanged
-> start runtime from published definition
-> instance pins exact process_def_id
-> publish newer version
-> existing instance remains pinned
-> new runtime resolves newer published version
-> draft/archived definitions cannot start accidentally
-> cross-tenant access fails closed
```

Only after this backend contract passes should the Google Studio mock transport be replaced with `EipStudioTransport`.
