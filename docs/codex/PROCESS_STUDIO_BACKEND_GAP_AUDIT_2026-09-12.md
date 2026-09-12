# Process Studio Backend Gap Audit — 2026-09-12

Base audited: `feature/route-temporal-gate-v1` at `b9eb19355cbc54ebe86cec833bfc8b7476daf369`

Preparation branch: `prep/process-studio-integration-v1`

Purpose: prepare EIP Core V2 for later integration of the Process Studio UI being developed separately in Google AI Studio. The Google WIP UI remains frozen; this work closes the backend adapter/lifecycle contract first.

## Summary

The Process Studio backend preparation is now closed at the contract/governance layer without creating a second Process Engine or a new Process feature table. Existing V2 Process structures remain authoritative.

| Area | Status | Evidence / action |
| --- | --- | --- |
| Process catalogue | READY | `/process/workbench/catalog` remains the governed catalogue projection |
| Process detail | READY | `/process/workbench/defs/:id` remains the governed detail projection |
| Draft create/update | CLOSED | lifecycle guard strips/rejects lifecycle escalation and published/archived content is immutable |
| Validation | CLOSED | canonical string errors remain intact and structured Studio `issues[]` are projected for UI consumption |
| Publish | CLOSED | publish remains server-validation-gated; `v2_0063` canonicalizes the persisted published lifecycle |
| Draft revision | CLOSED | `POST /process/defs/:id/revisions` creates a new draft version using existing `process_def` rows |
| Runtime version pinning | READY | `process_instance.process_def_id` continues to pin the exact selected definition row |
| Runtime published-only start | CLOSED | HTTP start pins a server-selected published definition; DB guard rejects any non-published/inactive definition insert |
| Process tenant authority for Studio adapter | CLOSED | transport contract is session-owned and does not expose raw `tenant_id` authority |
| Legacy raw tenant compatibility | BOUNDED | legacy Process routes still accept same-session tenant UUID compatibility input and fail closed cross-tenant; accepted Studio adapter must not send it |
| Task templates | CLOSED | CRUD remains existing; `v2_0063` prevents mutation when parent Process Definition is published/archived |
| Bindings | CLOSED | active binding target must be active + published; revision clones remain inert until publication |
| Operator runtime | READY | instances list/load/start/advance continue through the canonical Process Engine |
| Effect catalogue | READY | effect authority remains `PROCESS_EFFECT_TYPE` |
| Inline transition effects | CLOSED | canonical validator still rejects inline transition effect bundles |
| Reasoning runtime | READY FOUNDATION | governed reasoning/macro bridge remains the runtime authority |
| UI Studio backend foundation | READY FOUNDATION | `ui_surface` + code-owned renderer/primitive registry remain authoritative |
| New Process table | NOT REQUIRED | lifecycle/versioning/revision fit existing `process_def`, `task_template`, `process_binding`, `process_instance` structures |

## Closed findings

### 1. Existing Process authoring projection is retained

`buildProcessWorkbenchProjection(...)` remains the authoring/read projection for definitions. The integration layer augments responses with canonical lifecycle status rather than rebuilding Process interpretation in React.

The Google adapter must consume EIP projections and must not promote its mock models to persistence authority.

### 2. Validation authority remains EIP

`validateProcessGraph(...)` remains the server-side publication authority for:

- graph / initial-node correctness;
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

For Studio usability, the response layer now adds structured `issues[]` while preserving the canonical server `errors[]`/`details[]` strings.

### 3. Process Definition lifecycle is explicit and immutable

Canonical persisted states are:

```text
draft
published
archived
```

`v2_0063_process_definition_lifecycle_governance.sql` normalizes legacy rows and installs persistence guards without a new feature table.

Target behavior is now:

```text
draft vN
  -> edit task/process metadata
  -> validate
  -> publish vN
  -> immutable definition + task templates

published vN
  -> create draft revision vN+1
  -> edit
  -> validate
  -> publish vN+1
```

Operational `is_active` may still be toggled on a published definition without changing its immutable definition content.

### 4. Draft revision clones the version-owned execution contract

`POST /api/eip/process/defs/:id/revisions`:

- requires authenticated EIP write permission + CSRF;
- uses session tenant authority only;
- accepts a published source definition;
- serializes version allocation with a transaction advisory lock;
- creates a new draft `process_def` row;
- clones Task Templates because they participate in the pinned version's runtime behavior;
- clones bindings as inactive deployment candidates;
- marks only formerly active cloned bindings for activation when the new revision is published.

This prevents a published vN from changing because a Task Template was edited later.

### 5. Runtime selection fails closed on drafts/archives

Process Instance rows can only be inserted when the selected Process Definition is active and published.

For browser/API starts, the lifecycle guard resolves the currently eligible published definition and pins its exact `process_def_id` before the existing engine start path runs. Therefore a newer draft cannot accidentally supersede the current published version.

Active Process Bindings are also restricted to active published definitions.

Existing Process Instances are intentionally unaffected: advancement continues to load the exact historical `process_def_id` already pinned on the instance, including after that definition is later archived.

### 6. Archive is deployment retirement, not history deletion

`POST /api/eip/process/defs/:id/archive`:

- requires write permission + CSRF;
- uses the authenticated session tenant;
- marks the definition archived/inactive;
- deactivates its bindings;
- does not rewrite or delete historical Process Instances.

### 7. Studio tenant contract is session-owned

The accepted adapter contract remains:

```text
Studio browser
  -> authenticated EIP session
  -> server-owned session tenant
  -> governed Process routes
```

`PROCESS_STUDIO_TRANSPORT_V1.raw_tenant_id_allowed` remains `false`.

The old Process route compatibility layer still accepts a same-session UUID in some endpoints, but that is not part of the Studio adapter contract and cross-tenant input remains fail-closed. It can be retired independently after all legacy callers are migrated.

## Files added/changed in preparation

- `docs/architecture/PROCESS_STUDIO_INTEGRATION_CONTRACT_V1.md`
- `docs/codex/PROCESS_STUDIO_BACKEND_GAP_AUDIT_2026-09-12.md`
- `db/migrations/v2_0063_process_definition_lifecycle_governance.sql`
- `services/api/src/plugins/processStudioLifecycleGuard.js`
- `services/api/src/routes/process/process_studio_lifecycle.js`
- `services/api/src/services/process/processDefinitionLifecycle.js`
- `services/api/src/services/process/processStudioTransportContract.js`
- `services/api/src/services/process/processValidationIssues.js`
- Process Studio lifecycle/transport/validation regression tests.

## Governance evidence

GitHub Actions `V2 Security Governance Gates` run `34694646970` passed on the preparation branch before final documentation closeout. It covered:

- full API unit regression;
- Workbench UI unit tests;
- Workbench build;
- primitive Effect V1 validation;
- Owner Admin governance;
- security controls;
- tenant scope;
- process governance.

Any later documentation-only or guard-corrective commit must still finish with the same gates green before merge.

## Remaining integration work

Backend preparation is no longer waiting on lifecycle/versioning semantics. The next Process Studio step is UI adapter cutover after the Google AI Studio WIP is accepted:

```text
Google mock adapter
  -> EIP ProcessStudioTransport implementation
  -> governed EIP endpoints
```

The cutover must not import Google mock persistence, raw tenant UUID authority, executable JavaScript metadata, arbitrary CSS, or a second Process runtime.

## Freeze rule

Do not import or rewrite the Google AI Studio Process Studio while its UI work is active. Backend preparation and UI visual development remain parallel streams until adapter cutover.
