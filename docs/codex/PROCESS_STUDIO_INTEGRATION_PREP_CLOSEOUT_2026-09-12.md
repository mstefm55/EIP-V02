# Process Studio Integration Preparation Closeout — 2026-09-12

Base: `feature/route-temporal-gate-v1`
Preparation branch: `prep/process-studio-integration-v1`

## Result

Process Studio / future Business Analysis backend integration preparation is complete for the current Google AI Studio cutover boundary.

The Google WIP remains visually separate until accepted. No Google mock persistence, local workflow engine, tenant authority, executable metadata, or arbitrary CSS contract has been imported into EIP.

## Closed preparation areas

- Process Definition lifecycle: draft -> publish -> archive.
- Published/archived definition immutability.
- Draft revision creation from a published version.
- Task Template version ownership/immutability.
- Binding publication safety.
- Published-only new Process Instance starts.
- Exact `process_def_id` pinning for in-flight instances.
- Structured validation issues while preserving canonical server errors.
- Session-owned Studio tenant authority; raw browser tenant UUID excluded from the accepted Studio adapter.
- Explicit transport contract for Library, Process Studio, Operator Studio, Effect Studio, Reasoning Studio, and UI Studio.
- Shared organisation/resource vocabulary contract for the parallel UI workstreams.
- Organisation hierarchy anchored to `eip_core.agent` / `parent_agent_id` rather than frontend-owned team/employee schemas.
- Auth identity kept separate from Agent through `eip_auth.auth_identity_agent`.
- Task assignment/Service Object ownership/audit actor links anchored to Agent references.
- Workstation kept as a governed resource projection: Agent(s) + Asset(s) + capabilities + availability/capacity.
- No new Process/Organisation/Workstation feature table introduced.

## Canonical integration boundary

```text
Google Process Studio / Business Analysis UI
  -> injected transport/model adapter
  -> governed EIP API projection
  -> Process / Reasoning / UI engines
  -> kernel objects
```

The UI may author metadata and render projections. EIP remains authority for tenancy, permission, lifecycle, validation, execution, Effects, Reasoning, organisation scope, and runtime state.

## Organisation/resource integration checkpoint

The cross-UI contract is frozen in:

`docs/architecture/ORGANISATION_AGENT_WORKSTATION_INTEGRATION_V1.md`

It applies to:

- Business Analysis / Process Studio;
- Operational Workbench;
- Planning/Scheduling;
- future Admin Console migration.

Canonical internal vocabulary includes Organisation, Agent, Asset, Workstation, Service Object, Task, Task Template, Process Definition, Process Instance, Process Step, Macro, Effect, Reasoning, Party, Information Record, Object Link, UI Surface, and Resource.

## Explicit non-blocking/deferred item

Asset is a canonical kernel business class and Workstation composition expects Asset projections, but the current V2 migration chain does not yet contain the canonical persisted V1 Asset / Asset Assignment transfer equivalent.

This is intentionally **not** solved by Process Studio UI preparation and no table is approved here.

It becomes a dedicated audited V1->V2 kernel transfer decision before any feature claims real persisted asset-backed workstation management. Process Studio lifecycle/adapter cutover does not depend on that persistence.

## Adapter cutover acceptance

When the Google UI is accepted, the integration task is limited to:

```text
mock transport
  -> EipStudioTransport
  -> existing governed EIP endpoints
```

Acceptance must prove:

1. lossless Process Definition round-trip including graph, Task Templates, macro references, Effects, and Reasoning metadata;
2. no raw browser tenant UUID authority;
3. no local runtime fallback when EIP transport is unavailable;
4. published definitions remain immutable;
5. revision creation preserves historical versions;
6. runtime instances stay pinned;
7. taxonomy/primitive choices come from EIP/code-owned capability contracts;
8. organisation/team/Agent vocabulary maps to the canonical EIP model rather than prototype DTOs;
9. complete API/UI/security/tenant/process governance gates remain green.

## Next workstream

With Process Studio integration preparation closed, the next independent migration workstream is the stable V1 Admin Console -> V2 migration.

That migration starts with a parity/readiness audit and reuses the existing V2 UI engine, `OwnerAdminShell`, owner-admin API contracts, and metadata surfaces. Healthy V2 engines must not be replaced and V1 must not be copied blindly. Stable V1 UX is migrated where useful, then upgraded/revamped only where there is a concrete usability, security, metadata-governance, or architectural reason.
