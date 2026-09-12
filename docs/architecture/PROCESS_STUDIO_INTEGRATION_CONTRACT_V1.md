# Process Studio Integration Contract V1

Date: 2026-09-12
Status: backend preparation closed; Google UI adapter cutover pending

## 1. Purpose

This contract prepares EIP Core V2 to receive the Process Studio UI being developed separately in Google AI Studio.

The Google project is an authoring client. EIP remains the runtime and governance authority.

The Google WIP remains visually independent until accepted. Backend preparation closes lifecycle, versioning, validation-shape and transport boundaries without importing, rewriting, or duplicating that UI.

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
| Library | reusable/versioned definitions | `process_def`, governed metadata, reusable catalogue projections |
| Process Studio | process graph, task labels, macros, task templates, bindings | Process Definition + Process Engine contracts |
| Operator Studio | running instances, tasks, operational actions/history | Process Instance / Task runtime APIs |
| Effect Studio | governed effect catalogue and macro composition | `PROCESS_EFFECT_TYPE` + Process Engine handler registry |
| Reasoning Studio | governed rule/resolution authoring and preview | governed reasoning engine and metadata |
| UI Studio | governed UI composition | `ui_surface`, UI renderer/registry, shell profile references |

No Studio owns a second workflow engine.

The user-facing product may later be repositioned as Business Analysis or Business Design without changing these kernel contracts.

## 4. Tenant authority

The Google adapter MUST NOT send a raw `tenant_id` UUID as authority.

For the first integration cut, Process Studio operates in the authenticated session tenant. The accepted Studio transport contract is therefore:

```text
browser request
  -> authenticated EIP session
  -> server resolves session tenant
  -> tenant-scoped query / transaction
```

If a later Owner Admin cross-tenant Studio selector is required, it must use a server-provided tenant code/handle allow-list and server-side resolution, following the Connections control-plane pattern. Raw browser UUID authority remains forbidden.

Legacy Process routes still accept a same-session tenant UUID in some compatibility paths and fail closed for cross-tenant use. That compatibility input is not part of `PROCESS_STUDIO_TRANSPORT_V1` and must not be emitted by the Google adapter.

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

Compatibility metadata may continue to expose `attrs.is_published`; `attrs.lifecycle_status` is the canonical explicit lifecycle projection for Studio integration.

Rules:

1. A newly authored Process Definition is a draft.
2. Drafts are mutable.
3. Publish requires server-side full validation.
4. A published version is immutable as definition content.
5. Task Templates attached to a published/archived definition are immutable because they participate in pinned runtime semantics.
6. Editing a published definition creates a new draft version; it does not mutate the published row.
7. Process Instances remain pinned to the exact `process_def_id` they started with.
8. New Process Instances must select an active published definition.
9. Archiving prevents new selection and deactivates bindings but does not invalidate historical Process Instances.
10. Published `is_active` may be changed operationally without rewriting immutable process content.

No new lifecycle table is required for V1. Existing `process_def` version rows + governed attrs are sufficient.

Persistence enforcement is installed by `v2_0063_process_definition_lifecycle_governance.sql`.

## 6. Process Studio route inventory

### Library / Process Studio

- `GET /api/eip/process/workbench/catalog`
- `GET /api/eip/process/workbench/defs/:id`
- `POST /api/eip/process/defs`
- `PATCH /api/eip/process/defs/:id`
- `POST /api/eip/process/defs/:id/validate`
- `POST /api/eip/process/defs/:id/publish`
- `POST /api/eip/process/defs/:id/revisions`
- `POST /api/eip/process/defs/:id/archive`
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

The Google project should replace its mock transport with an injected adapter implementing this conceptual interface:

```text
listProcesses(filters)
getProcess(id)
createProcessDraft(input)
updateProcessDraft(id, patch)
validateProcess(id)
publishProcess(id)
createDraftRevision(id)
archiveProcess(id)

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

The adapter must be transport-only. It must not reproduce EIP validation, lifecycle, permission or tenant-authority logic.

## 8. Unified Process validation contract

Production Process Studio uses one authoritative server validation result for the complete five-layer model:

```text
Process Definition
  -> Task Label
  -> Macro
  -> Effect
  -> Service Object / category parameters
```

The existing process validator checks major structural rules including:

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

For Studio usability, the response layer projects a stable issue shape while preserving canonical error strings:

```json
{
  "valid": false,
  "errors": ["TRANSITION_MACRO_REQUIRED:review->approve"],
  "issues": [
    {
      "code": "TRANSITION_MACRO_REQUIRED",
      "location": "transition:review->approve",
      "message": "Select a macro for this transition."
    }
  ]
}
```

Friendly messages are a presentation concern. The server remains validation authority.

## 9. Revision and runtime version pinning

`process_instance.process_def_id` is the immutable runtime reference for an in-flight instance.

The Studio must never replace that reference when a later Process Definition version is published.

The expected lifecycle is:

```text
Process A v1 published
  -> Instance X starts on v1

Process A v2 draft
  -> edit cloned version-owned task templates
  -> validate
  -> publish

Instance X remains on v1
new instances resolve v2
```

`POST /process/defs/:id/revisions` creates the new draft row, clones Task Templates, and clones bindings as inactive candidates. Bindings cloned from active source bindings are activated only when the new revision is published.

For HTTP Studio/API starts, the lifecycle guard resolves and pins an eligible published definition before the existing engine creates the instance. The DB lifecycle trigger independently rejects insertion against inactive, draft or archived definitions.

Existing in-flight instances continue to advance against the exact historical `process_def_id` already pinned on the instance, including if that version is later archived.

## 10. Google WIP integration rules

While the Google AI Studio project is still under development:

- do not import it into `apps/workbench-ui`;
- do not modify its React/CSS from the EIP backend preparation branch;
- do not mirror its localStorage/mock persistence in EIP;
- do not expose database schema details to its components;
- do not make EIP depend on its mock DTOs.

When UI work is accepted, integration is performed only through the transport/model boundary.

The production adapter must fail closed if EIP transport is unavailable. It must never silently fall back to mock enterprise data.

## 11. Backend preparation closure status

Closed before adapter cutover:

1. **Published/archived Process Definition mutation**
   - persisted lifecycle is explicit;
   - published and archived definition content is immutable;
   - generic save cannot publish/archive by setting attrs directly.

2. **Draft revision creation**
   - canonical revision endpoint creates the next draft version using existing Process tables;
   - Task Templates are cloned as version-owned configuration;
   - bindings are cloned inert and become active only after publish where appropriate.

3. **Runtime draft/archive safety**
   - Studio/API starts resolve/pin active published definitions;
   - persistence rejects new instances against inactive/draft/archived definitions;
   - active bindings cannot target a non-published definition.

4. **Explicit lifecycle projection**
   - `lifecycle_status` is canonical;
   - compatibility `is_published` remains available for older consumers.

5. **Structured validation issues**
   - Studio receives `issues[]` while original canonical validation strings remain available.

6. **Session-owned Studio transport**
   - `PROCESS_STUDIO_TRANSPORT_V1.raw_tenant_id_allowed=false`;
   - Google adapter uses authenticated session tenant only.

Bounded compatibility note: legacy Process routes still contain same-session `tenant_id` compatibility handling. It is outside the accepted Studio adapter and remains cross-tenant fail-closed. Retiring that compatibility field can occur after legacy callers are migrated without blocking the Studio cutover.

Internal engine note: non-HTTP nested `PROCESS_START` calls remain protected by the DB published-only instance guard. If an internal caller resolves a newer draft by code instead of a published version, it fails closed rather than executing the draft. Studio/API start paths already resolve the current published version explicitly.

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

Backend preparation now enforces the required chain:

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
-> new Studio/API runtime resolves newer published version
-> draft/archived definitions cannot start accidentally
-> cross-tenant access fails closed
```

The remaining Process Studio step is not another backend engine wave. It is adapter cutover after the Google WIP is accepted:

```text
Google mock adapter
  -> EipStudioTransport
  -> governed EIP APIs
```

Complete V2 API/UI/security/tenant/process governance gates must be green on the final branch head before merge/deploy.
