# Frontend Salvage Map

This map classifies what should be ported, rewritten, stabilized, or left behind during the V2 frontend migration.

## Reading Rule

- If a legacy surface can be expressed as a reusable engine-backed contract, it may be ported.
- If a legacy surface hides workflow, lifecycle, or permission logic inside the page, it should be rewritten.
- If a legacy surface is mostly presentation, it can be salvaged through shared primitives.
- If a legacy surface is a one-off workaround, it should be retired unless explicitly approved as a controlled exception.

## Priority Buckets

### Port First

These are foundation surfaces that stabilize the migration:

- App shell
- Global navigation
- Layout chrome
- Auth/session-aware wrappers
- Shared loading, error, empty, and permission states
- Core UI primitives and tokens
- Engine-backed task and workflow status displays

Reason:

- They unblock many downstream screens.
- They have high reuse value.
- They are easiest to keep aligned with the UI engine source of truth.
- They assume the backend governance, DB baseline, and API shell are already stable.

### Rewrite First

These surfaces should be rewritten to remove legacy branching and bypass logic:

- Lifecycle action panels
- Approval and rejection flows
- Multi-step forms with hidden transitions
- Entity detail views that currently compute behavior locally
- Pages that encode visibility or action rules in component code

Reason:

- They are the highest risk for drift.
- They often duplicate engine decisions in a screen-specific way.
- They need direct consumption of service object state and metadata.

### Port After Stabilization

These can move once the shared contracts are stable:

- Read-heavy storefront listings
- Browse and filter pages
- Simple detail pages
- Reusable marketing or discovery surfaces
- Secondary content regions that do not own state transitions

Reason:

- They depend on shared primitives that should already exist.
- They are easier to migrate once the render path is normalized.

### Controlled Exceptions

Use only when the engine cannot yet represent the behavior:

- Temporary adapters for a missing engine capability
- Legacy compatibility shims required for a staged cutover
- Narrow fallback rendering for a blocked release path

Rules:

- Must have an owner.
- Must have an expiry or removal milestone.
- Must not become a shared pattern.
- Must not introduce new page-local business logic.

### Retire / Do Not Copy

Do not bring these forward as-is:

- Monolithic storefront orchestration
- Page-owned lifecycle bypass logic
- Duplicate state machines that shadow engine state
- Direct hardcoding of permission, status, or transition rules
- Screen-local data mutation that should be a workflow action

## Salvage Targets

### Shared UI Engine Assets

Port these into shared, reusable form:

- tokens
- layout primitives
- render helpers
- state badges
- table/list scaffolding
- form controls that are not domain-specific

### Engine-Driven Surface Contracts

Rewrite these to consume engine output:

- service object summaries
- workflow/task queues
- object action bars
- lifecycle status panels
- approval command UIs

### Storefront Surface Elements

Salvage these only as presentational building blocks:

- product cards
- list tiles
- filter chips
- empty states
- media and preview components

Do not salvage storefront behavior that decides:

- what action is allowed
- when a lifecycle step occurs
- how state transitions are validated
- which workflow owns the operation

## Migration Order

1. Stabilize the UI engine contract.
2. Confirm the backend governance, DB baseline, and API shell are stable enough for frontend consumption.
3. Port shared primitives and shell structure.
4. Rewrite lifecycle-bound screens to use engine state.
5. Port read-heavy surfaces through the stabilized contracts.
6. Add controlled exceptions only when blockers remain.
7. Remove exceptions as soon as the engine can represent the behavior.

## Source-of-Truth Rule

The UI engine is the authoritative source for:

- allowed actions
- current state
- transition eligibility
- workflow ownership
- service object rendering hints
- tenant-scoped surface discovery and composition metadata

Legacy screens may surface that information, but they must not redefine it.

## Runtime Cache Rule

- Cache keys must include `tenant + realm + surface_code + version/etag`.
- Memory cache is primary.
- Session/browser storage may keep only non-sensitive UI hints.
- Sensitive auth/session/permission data must never be cached in localStorage.

## Anti-Pattern Warnings

- Do not infer business rules from storefront JSX structure.
- Do not clone legacy lifecycle branching into new shared components.
- Do not create a second permission system in the UI.
- Do not let a temporary compatibility shim become permanent architecture.
- Do not accept a screen-local workaround when the engine contract is missing; instead, record the gap and isolate the exception.

## Exit Criteria

The salvage map is complete when:

- every legacy surface is tagged as port, rewrite, defer, exception, or retire
- the UI engine owns the shared behavior contract
- storefront rendering uses reusable primitives instead of monolithic page logic
- lifecycle bypass logic has no new home in V2
- every exception is documented and time-bound
