# EIP Core V2 - Codex Project Guidance

Read this first. Keep V2 kernel-first, engine-first, multi-tenant, and governed.
## Mandatory drift check for every wave

Every implementation wave must end with an explicit drift check before the wave can be considered complete.

The drift check must verify at minimum:

1. kernel-first alignment
- no change undermines the service object canon
- no change bypasses the process engine as lifecycle authority
- no change weakens the multi-tenant model

2. process-model alignment
- process remains DB-driven
- task labels remain business-facing only
- macro/effect structure remains reusable
- effect catalog authority remains metadata-governed (`PROCESS_EFFECT_TYPE`, `canonical_effect_code`)
- service object + service object category remain runtime parameters
- no task-list explosion or hidden one-off workflow logic is introduced
- no inline transition effect bundles are reintroduced

3. UI-engine alignment
- no page or route becomes the hidden business workflow authority
- UI behavior remains engine-/metadata-/surface-driven where intended

4. security / tenancy alignment
- no route-local tenant/authz shortcut becomes primary control
- no direct DB row exposure to frontend
- no secret leakage or weakening of centralized controls

5. schema discipline
- no unjustified new table
- no convenience schema drift
- all schema additions are documented in the New Table Justification Register

Required drift-check output for every wave:
- what drift risks were checked
- whether any drift was found
- what was corrected
- what remains intentionally deferred
- final yes/no:
  - is this wave aligned with V2 intent?

A wave is not complete without this drift check.

## Non-negotiables
- Preserve the service object canon at both levels: global kernel concept and operational case instance.
- Preserve the process engine, task/workflow engine, and UI/rendering engine.
- Keep shared code tenant-agnostic; isolate tenant behavior through metadata, configuration, assets, or approved extension points.
- Use relational modeling for core governed data and JSONB for flexible tenant/object payloads under governance.
- Prefer reusable abstractions over one-off flows, hardcoded screens, or tenant-specific shortcuts.

## Mandatory reread
Before any task touching `service_object`, process modeling, task taxonomy, workflow engine, UI engine, JSONB governance, or multi-tenant kernel behavior, reread:
- `AGENT_TASKS.md`
- `docs/codex/ARCHITECTURE_GUARDRAILS.md`
- `docs/codex/SERIAL_CONTEXT_001.md`
- `docs/codex/SERIAL_CONTEXT_003.md`
- `docs/codex/DRIFT_CLOSURE_0010.md`
- `docs/codex/WAVE_4_CORE_CONSOLIDATION.md`
- `docs/codex/WAVE_4_5_MACRO_RUNTIME_CLOSEOUT.md`
- `C:\Projects\EIP\eip-core\docs\PROCESS_V2_INTENT.md`
- relevant `docs/dev/*.md`
- `docs/architecture/KERNEL_CANON.md`
- `docs/architecture/SERVICE_OBJECT_CANON.md`
- `docs/architecture/TASK_EFFECT_MODEL.md`
- `docs/architecture/OWNER_ADMIN_SHELL_PROFILE_LIFECYCLE.md` (mandatory when touching shell/theme profile governance, tenant overrides, or UI shell caching)

## Work rules
- Before changing anything, reread this `AGENTS.md` and apply it as binding guidance for the whole wave.
- Do not edit files outside your assigned ownership.
- Do not bypass the kernel or engines to make a feature work faster.
- Run relevant checks for any files you change.
- For process-governance-sensitive work, run `node scripts/validate_process_governance.mjs`.
- For every completed wave, update `docs/dev/DEVELOPER_MANUAL.md` with:
  - progress entry in `V2 Progress Record`
  - architecture delta in `Full System Explanation`
- End every task with: files changed, behavior implemented, checks run, assumptions, and risks.
## New table control rule

A table being absent from V1 is not by itself a reason to reject it.
However, no new table may be introduced in V2 unless all of the following are true:

1. it is required by the kernel-first, engine-first, multi-tenant, or security model
2. the need cannot be cleanly satisfied through existing governed structures, extension points, or JSONB-governed metadata
3. the table does not bypass or weaken the service object/process/task/UI engine direction
4. the table does not introduce hardcoded business-specific shortcuts
5. the reason for the new table is documented explicitly

For every proposed new table, provide:
- purpose
- why existing V1/V2 structures are insufficient
- kernel/engine/security justification
- whether it is foundational or feature-specific
- whether it is mandatory now or can be deferred

If the justification is weak, prefer adapting existing structures instead of creating a new table.
## Complete-block execution policy

For V2 core work, every wave must aim to close one full production block, not partially touch a block.

### Mandatory behavior
When a wave targets a block, the implementation must in the same wave:
1. inspect the target block
2. discover all dependent subcomponents required for that block to be truly complete
3. include those dependent subcomponents in the same wave if they are necessary for completion
4. implement the block in its intended production-safe form
5. run validation/checks
6. report completion only if the block is truly closed

### No partial-block rule
Do not leave a block partially:
- scaffolded
- mounted
- governed
- secured
- validated
- renderer-backed
- runtime-ready

unless the user explicitly requested a prototype or partial implementation.

### Expansion rule
If completing the target block requires closely related dependent work, expand the wave to include it automatically, as long as:
- it stays within the same architectural block
- it does not widen into unrelated module sprawl
- it preserves kernel-first, engine-first, security-first direction

### Hard blocker rule
If the block cannot be completed in the same wave because of a real blocker, do not present the block as complete.
Instead, report:
- exact blocker
- exact files/modules involved
- exact missing prerequisite
- exact next required block

### Definition of done rule
A block is complete only when all of the following are true:
- it works in default runtime, not only temporary tests
- its required governance is in place
- its required security is in place
- its required DB/runtime dependencies are in place
- it does not depend on an immediate corrective follow-up wave for the same block
- drift check passes for that block

### For process/UI/security/core blocks
Always prefer closing the block fully in one wave, even if that means handling a few tightly related sub-parts together.
This is preferred over spreading one logical block across many waves.
## UI engine ownership and tenant-scoped metadata policy

For V2, all UI runtime code is UI-engine-owned.

This means:
- renderer, registry, primitive library, contract client, safe asset resolver, safe local UI state helpers, and caching/runtime orchestration remain in code
- tenant variability must be metadata-driven and DB-governed
- business/process authority must remain server-side and must not drift into JSX/page code

### Required UI ownership model

UI must follow this structure:

1. code-owned engine layer
- renderer
- registry
- whitelisted primitive library
- contract resolver/client
- safe asset resolver
- safe state/caching helpers
- safe accessibility/render/runtime behavior

2. DB-owned tenant-scoped metadata layer
- surface tree / composition
- primitive selection from whitelisted library
- labels / captions / help text
- grouping / sections / tabs
- ordering / positioning
- sizing / layout hints / style tokens
- field schemas / table columns / filter definitions
- action bindings / contract references
- visibility/editability/default rules
- asset keys (not raw JS imports)
- tenant-specific UI overrides
- `attrs.shell_profile_code` may reference shell identity only; owner-admin shell/theme payload belongs to governed profile metadata (`OWNER_ADMIN_SHELL_PROFILE`) plus controlled tenant override metadata (`OWNER_ADMIN_SHELL_THEME_OVERRIDE`)

3. server-owned authority layer
- permissions
- validation
- publish rules
- process legality
- macro/effect legality
- lifecycle transitions
- service object/service object category legality

### Non-negotiable UI rules

- page JSX must not become hidden business authority
- UI code may implement safe primitives, but not business-specific workflow ownership
- workbench/domain composites must not be registered as primitives in `engine/registry.jsx`
- metadata should compose generic primitives first; keep domain composites only as explicit compatibility exceptions
- tenant changes such as labels, object names, attributes, layouts, visibility, editor choice, and ordinary action placement should not require recoding if they fit within existing primitives
- only genuinely new primitive behavior should require new code
- metadata must be tenant-scoped
- use asset keys or governed asset references, not direct business-page-owned imports inside tenant metadata
- prefer tokenized layout/style hints over uncontrolled raw style blobs where practical
- do not allow arbitrary executable code from DB metadata

### Auth/login UI production-ready gate (mandatory for UI waves and deployments)

- Every visible login/auth control must be fully operational; no placeholder, demo, or empty-shell buttons in runtime UI.
- `Quick Access` and `Request Access` controls must be wired to real governed flows (modal + action + backend route), or removed from UI.
- Standard user login UI must not expose `Tenant ID override`; tenant selection must use business-facing organization/tenant code UX.
- TOTP setup must use authenticator-app registration with QR/`otpauth://` provisioning plus code verification; do not replace with non-equivalent custom shortcuts.
- Do not duplicate the same action through conflicting controls (example: separate “open panel” button when a governed setup action already exists).
- User-visible auth copy must be business language; do not expose UUID/debug internals in success/error notices.
- Before claiming completion, validate end-to-end: password login, OTP request/verify, TOTP bootstrap+verify via authenticator app, logout, and session/CSRF safety.

### Admin/workbench UI production-ready gate

- Reuse V1-proven admin/process-builder UX patterns where they improve usability, but keep V2 engine-owned runtime and server authority.
- Any visible admin/workbench control (tab, button, dropdown, modal action) must be fully operational or removed.
- Process-builder authoring UX must keep the canonical 5 layers explicit:
  1. process definition
  2. task label
  3. macro
  4. effect library
  5. service object type/category runtime parameters
- Transition authoring should attach task label + macro where possible; effect selection must come from governed metadata (`PROCESS_EFFECT_TYPE`) and remain reusable/generic.
- Do not reintroduce hardcoded per-module workflow authority in page JSX; module variation must remain metadata-driven.

### Performance and caching rules for UI metadata

UI metadata should be designed for efficient delivery and rendering.

Required rules:
- metadata must be tenant-scoped
- surface payloads should support stable cache identity using tenant + realm + surface code + version/etag
- use memory cache first for active runtime reuse
- use sessionStorage/localStorage only for non-sensitive metadata and only with tenant-scoped/versioned keys
- never cache secrets, auth tokens, or sensitive personalized data in localStorage
- invalidate cached metadata on version/etag mismatch
- minimize metadata roundtrips where possible
- prefer contract-driven lazy loading for heavy detail panels
- performance must be considered part of UI architecture, not an afterthought

### Mandatory UI quality check for every UI-related wave

Every wave that touches UI must end with an explicit UI quality check.

It must verify at minimum:

1. engine ownership
- renderer/registry/primitive library remain the UI authority
- no page component becomes hidden workflow authority

2. metadata ownership
- tenant variability moved into metadata where appropriate
- labels/layout/order/visibility/actions are not unnecessarily hardcoded

3. server authority
- business/process/permission logic remains server-side
- frontend does not become lifecycle authority

4. tenant scope
- UI metadata is tenant-scoped
- no cross-tenant metadata leakage assumptions

5. performance
- metadata loading path is efficient
- cache strategy is defined and safe
- no unnecessary roundtrip explosion

6. safety
- no arbitrary code execution from metadata
- asset resolution is controlled
- auth/session/csrf boundaries are preserved

A UI block is not complete unless this UI quality check is included in the output and passes.
## Canonical definition of UI primitive

A UI primitive is a domain-neutral, reusable, engine-owned building block that can be configured by metadata and reused across many modules, tenants, and object types without changing its source code.

A component is a true primitive only if all of the following are true:
1. it is domain-neutral
2. it is metadata-configurable
3. it is reusable across many surfaces/modules/tenants
4. it does not own business workflow authority
5. it does not embed business-specific structure as its identity
6. it is part of the safe whitelisted UI engine runtime

Examples of true primitives:
- SurfaceRoot
- PanelHeader
- Section
- Tabs
- SplitLayout
- ActionBar
- StateNotice
- FieldRenderer
- SchemaForm
- DataGrid
- ListView
- DetailView
- Inspector
- Timeline
- ContractTablePanel
- ContractRecordEditor

Examples of non-primitives (workbench/domain composites):
- ProcessDefinitionStudio
- TaskTemplateWorkbench
- ProcessBindingWorkbench
- ProcessInstanceStream
- ProcessWorkbenchCatalog

Rule:
A workbench/domain-specific composite must never be classified as a primitive.
It may exist temporarily as a composite, but the target architecture is to assemble more of its structure from generic primitives + metadata.

Primitive test:
If the object name, tenant, fields, layout, and module can all change without changing the component source code, it is likely a primitive.
If not, it is likely a composite.

Mandatory UI primitive gate for every UI wave:
- classify every JSX/component file into exactly one bucket:
  - true primitive
  - engine shell/support
  - domain/workbench composite
  - page/app shell
- verify `engine/registry.jsx` keeps only true primitives in `primitiveLibrary`
- verify workbench/domain composites are never placed in `primitiveLibrary`
- if runtime metadata migration is required for closure (for example `v2_0014_workbench_ui_generic_primitive_composition.sql`), apply it to the active runtime DB before claiming completion

Mandatory component folder structure:
- all UI components must be organized under:
  - `apps/workbench-ui/src/components/primitives/`
  - `apps/workbench-ui/src/components/composites/`
  - `apps/workbench-ui/src/components/shell/`
- engine runtime files must remain under `apps/workbench-ui/src/engine/`
- do not keep ambiguous top-level component files directly under `apps/workbench-ui/src/components/`
