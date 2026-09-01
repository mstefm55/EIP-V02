# UI_ENGINE_OWNERSHIP

## Purpose

Define the production ownership boundaries for the V2 UI engine runtime.

Read with `PLANNING_AND_SCHEDULING_METADATA_V1.md` for the Planning/Scheduling data that may be presented by the UI without moving planning authority into frontend code.

## Ownership Model

- Code-owned:
  - renderer recursion and primitive dispatch
  - primitive registry allowlist
  - primitive/composite separation enforcement in registry
  - contract/token resolution utilities
  - auth/session transport + CSRF handling
  - asset key allowlist resolution
- Metadata-owned platform shell/theme profile layer:
  - bootstrap catalog source in `OWNER_ADMIN_SHELL_PROFILE` (legacy seed source only)
  - lifecycle authority in `eip_core.ui_shell_profile` + `eip_core.ui_shell_profile_revision` + `eip_core.ui_shell_profile_event`
  - profile branding keys (`logo_key`, `icon_key`, `favicon_key`, `hero_key`)
  - profile layout variant and shared shell tokens
  - published runtime authority (`eip_core.ui_shell_profile_published`)
  - controlled tenant overrides in `tenant.tenant_settings` (`OWNER_ADMIN_SHELL_THEME_OVERRIDE`)
  - controlled tenant profile selection in `tenant.tenant_settings` (`OWNER_ADMIN_SHELL_PROFILE_SELECTION`)
- Metadata-owned `ui_surface` layer (`eip_core.ui_surface`):
  - surface discovery attributes (label/order/default/asset key)
  - surface composition tree
  - node-level labels and layout hints
  - contract endpoint templates and runtime token references
  - surface-level shell profile reference (`attrs.shell_profile_code`)
- Server-owned:
  - authentication and authorization
  - tenant/realm scoping
  - process/workflow lifecycle authority
  - Planning/Scheduling calculation and accepted schedule authority
  - response boundary and governed metadata enforcement

## Primitive Library Boundary

- Canonical primitive criteria (all required):
  1. domain-neutral
  2. metadata-configurable
  3. reusable across modules/tenants/object types without source edits
  4. no business workflow authority
  5. no business-specific structure as identity
  6. included in safe allowlisted engine runtime
- True primitives must remain generic and reusable across domains.
- Workbench/domain composites must not be registered as primitives.
- Current generic primitive examples:
  - `SurfaceRoot`
  - `PanelHeader`
  - `SplitLayout`
  - `Tabs`
  - `ContractTablePanel`
  - `ContractRecordEditor`
  - `ContractDetailEditor`
- Legacy workbench composites may still exist in source as migration references, but must not remain registered runtime primitives/composites once equivalent metadata + generic primitive composition is active:
  - `ProcessDefinitionStudio`
  - `ProcessWorkbenchCatalog`
  - `TaskTemplateWorkbench`
  - `ProcessBindingWorkbench`
  - `ProcessInstanceStream`
- Surface metadata should prefer generic primitives for composition, and keep composites only when no safe generic equivalent exists yet.
- Primitive test:
  - if object name, tenant, fields, layout, and module can all change via metadata without source edits, it is likely a primitive; otherwise it is a composite.

## Component Structure Boundary

- Component source layout is mandatory:
  - `apps/workbench-ui/src/components/primitives/`
  - `apps/workbench-ui/src/components/composites/`
  - `apps/workbench-ui/src/components/shell/`
- Engine runtime modules remain outside components:
  - `apps/workbench-ui/src/engine/*`
- Keep this separation strict so primitive/composite authority is auditable and enforceable.

## Tenant Scope Rules

- Surface discovery and selection identity is tenant + realm scoped.
- Surface metadata resolution must prefer tenant overrides and safely fall back to global metadata.
- UI metadata must not bypass server-derived tenant context.
- Owner-admin shell/theme payload must resolve from governed shell profiles + controlled tenant overrides, not from embedded `ui_surface` theme blobs.
- `ui_surface` may reference which shell profile to use, but must not carry raw shell token bundles.
- Shell profile resolution order must be tenant surface selection -> tenant global selection -> `ui_surface.attrs.shell_profile_code` -> fallback profile.

## Shell Lifecycle Rules

- Shell profile payloads are versioned and lifecycle-governed:
  - `draft`
  - `published`
  - `archived`
- Runtime may consume only published revisions.
- Rollback is publish-safe by promoting a new version from historical payload lineage.
- Audit/history is append-only through shell profile event logging.
- Lifecycle workflow details are defined in `docs/architecture/OWNER_ADMIN_SHELL_PROFILE_LIFECYCLE.md`.

## Cache and Storage Rules

- Surface/cache identity: `tenant_id + realm + surface_code + version/etag`.
- Use memory cache for catalog + surface payloads.
- Use `sessionStorage` only for non-sensitive UI hints (for example, last selected surface).
- Never store session/auth/permission/CSRF/sensitive personalized payloads in `localStorage`.

## Safety Rules

- Metadata is data only; it is never executable code.
- No runtime eval/function construction from metadata.
- Primitive dispatch must stay allowlisted.
- Asset references from metadata must resolve via safe in-code key registry.
- Theme token overrides must be allowlisted and validated (for example strict color-token keys + safe color syntax); arbitrary CSS/value injection is forbidden.
- Branding overrides (logo/favicon/icon/hero) must resolve through safe asset keys; raw uncontrolled URLs are forbidden.
- Tenant selection/override metadata must be treated as data, validated, and never allowed to create arbitrary shell architecture.

## Planning / Scheduling UI Handoff

The UI Engine presents Planning/Scheduling state but does not calculate it.

Server/API projections may expose bounded generic fields such as:

```text
Service Object identity
route steps / process identity
route step state
planned_start_at
planned_finish_at
actual completion/start facts
maturity / wait reason
schedule revision / source
freeze/protection state
resource candidate identity
required workload
candidate duration
load min / average / max
load status / ratio
capacity required / available
exception/provenance summary
```

The UI may use metadata to choose labels, columns, ordering, grouping and layout. It must not implement:

```text
MRP netting
CRP load calculation
resource eligibility
batch-duration calculation
schedule ranking
critical-path calculation
freeze/replan decisions
```

Those remain server/Process/Macro responsibilities.

### First UI slice

The first Planning/Scheduling UI should prove the engine before adding advanced visual primitives.

Preferred first surface composition:

```text
SurfaceRoot
  -> PanelHeader
  -> SplitLayout
       -> ContractTablePanel
            route/process rows
            planned dates
            state/maturity
            schedule revision
       -> ContractDetailEditor / ContractRecordEditor
            selected Service Object
            workload/capacity/load facts
            resource/provenance facts
```

This deliberately uses existing generic primitives. A timeline/Gantt/capacity visual may be admitted later only as a domain-neutral primitive after the generic API projection is stable.

### Generic visualization admission rule

A new visual primitive is admitted only if the same component can render metadata/data from materially different domains without source edits. Examples of potentially admissible future primitives:

```text
Timeline / interval lane
Capacity meter
Metric card
Exception list
Dependency graph
```

Names such as `ProductionSchedule`, `HospitalScheduler` or `FleetDispatchBoard` are not primitive identities.

## UI Engine Readiness Gate

Before declaring the UI Engine ready for the first user-facing surface:

1. renderer recursion is bounded and uses only the allowlisted registry;
2. surface payload is sanitized and bounded before rendering;
3. contract endpoints are normalized/allowlisted and unresolved path tokens fail closed;
4. tenant/realm surface selection is server-derived and scoped;
5. shell/theme profile resolution consumes published governed metadata;
6. generic primitives cover table/list/detail/edit composition without domain composites;
7. API projections carry business/process semantics so frontend code does not recreate them;
8. Planning/Scheduling fields are presentation-only in the UI Engine;
9. write actions continue through governed API/Process/Effect paths rather than direct frontend state authority;
10. first surface can be defined mostly through `ui_surface` metadata.

## Quality Check (Mandatory in UI Waves)

1. Engine ownership check
2. Metadata ownership check
3. Server authority check
4. Tenant-scope check
5. Performance/caching check
6. Safety check
