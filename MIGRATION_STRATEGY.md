# V1 -> V2 Migration Strategy

## Objective
Build V2 coherently while V1 remains live, by salvaging compliant components and rewriting drifted components in a controlled sequence.

## Strategy principles
- Preserve kernel-first and engine-first direction.
- Keep V1 read-only; all implementation occurs in V2.
- Port only after classification (`keep`, `adapt`, `rewrite`, `unknown`).
- Prefer smallest safe vertical slices over bulk copy.
- Enforce security and tenant isolation at shared-kernel boundaries.

## Execution order (coherent sequence)

### Stage 0 - Freeze architecture and contracts
1. Lock constitutional docs (`AGENTS.md`, `ARCHITECTURE_GUARDRAILS`, serial context).
2. Freeze service object canon and process/task/effect model.
3. Freeze API contract baseline for parity checks.

Why first: prevents architecture drift during migration work.

### Stage 1 - Establish V2 DB and migration spine
1. Finalize DB strategy (`hybrid` recommendation).
2. Start new V2 migration chain (`v2_0001...`).
3. Keep consolidated delta draft and decompose into additive migrations.

Why early: backend and frontend both depend on stable schema strategy.

### Stage 2 - Port kernel foundations before domain modules
1. Core process engine primitives (salvage/adapt).
2. Process taxonomy/dropdown governance.
3. Auth/session/csrf/idempotency primitives.
4. Tenant context and permission enforcement boundary.

Why before domain: domain routes must call stable kernel services, not own lifecycle behavior.

### Stage 3 - Port/adapt integration boundaries
1. Gateway/public gateway contract surfaces.
2. Outbound integration client safety wrappers.
3. Audit/redaction and observability primitives.

Why now: external side effects must be controlled before domain migrations.

### Stage 4 - Domain backend migration (strictly controlled)
1. CRM flows that already align with process-engine usage.
2. Commerce/order/payment flows with explicit transition mapping.
3. Ecom lifecycle paths with direct status bypass logic rewritten first.

Why this order: migrate lower-drift domains first; high-drift ecom paths require rewrite before reuse.

### Stage 5 - Frontend/UI engine migration
1. Shared shell and UI engine runtime contracts.
2. Admin/dashboard surfaces via DB-backed surface model.
3. Storefront read-heavy surfaces (catalog/detail) through governed adapters.
4. Storefront lifecycle/action surfaces only after backend engine paths are stable.

Why this order: frontend must consume stable backend contracts and engine semantics.

### Stage 6 - Hardening, parity, and cutover
1. Contract parity suite (V1 vs V2) for critical flows.
2. Security gates and regression suites.
3. Canary rollout with rollback drill.

Why last: release confidence depends on measured parity and controlled rollback.

## What must be rewritten before any port
- Direct lifecycle state mutation paths that bypass process engine.
- Unsafe rendering sinks and ad hoc HTML injection patterns.
- Tenant-target actions without explicit target-tenant authorization checks.
- Permission helper logic that can produce inconsistent active-role behavior.
- Route-local business logic that should be expressed as engine effects/transitions.

## What can be ported early with minimal change
- Process taxonomy/dropdown governance model.
- UI surface storage/fetch pattern.
- Session/CSRF/idempotency primitive concepts.
- Multi-tenant schema conventions and core relational structures.
- Shared integration patterns that already enforce inbound verification boundaries.

## Dependency stabilization requirements
- Stable V2 migration baseline before backend module porting.
- Stable backend API contracts before frontend migration slices.
- Central authz and tenant guard primitives before gateway/domain actions.
- Security redaction/logging patterns before integration rollout.

## Anti-drift safeguards
- No module can move from V1 to V2 without an entry in `REUSE_MATRIX.md`.
- Any `adapt` item must carry explicit delta notes before implementation.
- Any `rewrite` item is blocked from copy-through.
- CI must fail on forbidden lifecycle-bypass patterns in V2 runtime code.
- Architecture-sensitive tasks must re-read codex guardrails before edits.

## Coexistence and rollback model
- V1 remains operational as the fallback path.
- V2 rollout is staged (shadow/parity -> canary -> broader rollout).
- Rollback is operationally simple (runtime switch), documented, and drilled.

## Completion criteria
- Critical flows pass parity thresholds.
- Security gate passes with no unresolved critical findings.
- Engine-driven lifecycle model enforced in migrated modules.
- V2 migration chain is authoritative and replayable.
