# EIP Core V2 Roadmap Checklist

Status: Draft
Last updated: 2026-03-24
Scope: Build a coherent V2 foundation while V1 remains live and untouched.

## How to use this file
- This is the execution checklist, not a concept note.
- Do not mark an item done without evidence (PR, test report, migration ID, or runbook link).
- V1 and V2 must stay partitioned at all times.
- No wholesale module copy from V1 without passing reuse gates.

## Global gates (must remain true)
- [ ] `GATE-001` V1 codebase remains read-only in this program.
- [ ] `GATE-002` V1 runtime remains live during V2 build.
- [ ] `GATE-003` V2 schema evolution uses a new `v2_####` migration chain.
- [ ] `GATE-004` Workflow lifecycle changes in V2 occur via process engine only.
- [ ] `GATE-005` Shared V2 code is tenant-agnostic by default.
- [ ] `GATE-006` Security controls are enforced in shared kernel, not page-level patches.

## Phase 0 - Bootstrap and Architecture Lock

### Repo/bootstrap tasks
- [ ] `P0-001` Confirm `C:\Projects\EIP\eip-core-v2` exists and is a separate git repo.
- [ ] `P0-002` Create baseline structure: `docs/codex`, `docs/dev`, `docs/architecture`, `docs/db`, `db/migrations`, `db/sql`, `scripts`.
- [ ] `P0-003` Publish constitutional docs: `AGENTS.md`, `AGENT_TASKS.md`, `README.md`.

### Architecture lock tasks
- [ ] `P0-004` Lock service object canon at both levels (conceptual + case-instance).
- [ ] `P0-005` Lock process/task/effect model and anti-task-explosion rules.
- [ ] `P0-006` Lock multi-tenant and governed JSONB rules in codex guardrails.
- [ ] `P0-007` Resolve V1 documentation contradictions in V2 guidance docs.

### Go/No-go
- [ ] `P0-GATE` Go only if V2 constitution is clear and non-contradictory.

## Phase 1 - Partition and Reuse Control

### Partition tasks
- [ ] `P1-001` Maintain `V1_V2_PARTITION.md` with keep/adapt/rewrite/unknown by major area.
- [ ] `P1-002` Keep overall baseline percentages visible (current reference: keep 32 / adapt 43 / rewrite 25).
- [ ] `P1-003` Maintain `REUSE_MATRIX.md` with module-level action and rationale.

### Reuse gates
- [ ] `P1-004` Any "keep" candidate must pass kernel/engine and security checks before porting.
- [ ] `P1-005` Any "adapt" candidate must define explicit delta work before implementation.
- [ ] `P1-006` Any "rewrite" candidate must not be copied into V2 source as-is.

### Go/No-go
- [ ] `P1-GATE` Go only if every major V1 area is classified and mapped.

## Phase 2 - DB Strategy and Migration Foundation

### DB strategy tasks
- [ ] `P2-001` Finalize V2 DB strategy in `DB_V2_STRATEGY.md`.
- [ ] `P2-002` Finalize clone safety and delta decomposition plan in `docs/db/DB_CLONE_AND_DELTA_PLAN.md`.
- [ ] `P2-003` Finalize migration bootstrap contract in `docs/db/V2_MIGRATION_BOOTSTRAP.md`.

### Migration chain tasks
- [ ] `P2-004` Keep new V2 migration namespace (`v2_0001` onward) and forbid V1 numbering continuation.
- [ ] `P2-005` Keep a structured consolidated delta draft in `db/sql/v2_consolidated_delta_draft.sql`.
- [ ] `P2-006` Replace placeholders with executable additive migrations in controlled increments.

### Coexistence and safety tasks
- [ ] `P2-007` Document non-destructive bootstrap steps only (no destructive DB commands).
- [ ] `P2-008` Define rollback and re-run criteria per migration batch.

### Go/No-go
- [ ] `P2-GATE` Go only if DB plan is auditable, replayable, and V1-safe.

## Phase 3 - Backend/Kernel Salvage Execution

### Backend salvage tasks
- [ ] `P3-001` Port process kernel pieces classified as keep/adapt in dependency order.
- [ ] `P3-002` Re-implement lifecycle paths that bypass process engine (rewrite bucket).
- [ ] `P3-003` Centralize permission checks and active-role enforcement.
- [ ] `P3-004` Keep API contracts stable via adapter layer while implementation changes underneath.

### Module-level checklist
- [ ] `P3-MOD-001` Core process engine module
- [ ] `P3-MOD-002` Process route module
- [ ] `P3-MOD-003` Auth/session/csrf module
- [ ] `P3-MOD-004` Gateway/public gateway module
- [ ] `P3-MOD-005` Ecom/commerce lifecycle modules
- [ ] `P3-MOD-006` Admin/tenant-boundary modules

### Go/No-go
- [ ] `P3-GATE` Go only if no direct lifecycle status bypass remains in ported V2 modules.

## Phase 4 - Frontend/Surface/Storefront Salvage Execution

### Frontend salvage tasks
- [ ] `P4-001` Port UI engine runtime foundations first (loader, renderer, registry governance).
- [ ] `P4-002` Port DB-surface driven screens before storefront-heavy custom screens.
- [ ] `P4-003` Rewrite unsafe rendering sinks; do not carry legacy unsafe HTML paths.
- [ ] `P4-004` Keep storefront migration contract-driven; block monolithic copy-through.

### Module-level checklist
- [ ] `P4-MOD-001` Shared shell and navigation
- [ ] `P4-MOD-002` Auth surfaces
- [ ] `P4-MOD-003` Admin/process builder surfaces
- [ ] `P4-MOD-004` Dashboard/user workbench surfaces
- [ ] `P4-MOD-005` Storefront catalog and detail views
- [ ] `P4-MOD-006` Storefront lifecycle action views

### Go/No-go
- [ ] `P4-GATE` Go only if UI behavior is engine-driven and not page-hardcoded.

## Phase 5 - Security Uplift Program

### Security tasks
- [ ] `P5-001` Implement controls defined in `SECURITY_TARGET.md`.
- [ ] `P5-002` Apply security architecture in `docs/architecture/SECURITY_CONTROL_FRAMEWORK.md`.
- [ ] `P5-003` Fix critical findings first: XSS sinks, tenant attrs exposure, tenant-target authorization gaps.
- [ ] `P5-004` Resolve high-priority auth/session/password policy weaknesses.
- [ ] `P5-005` Add dependency and secrets scanning gates.

### Domain checklist
- [ ] `P5-DOM-001` Authentication
- [ ] `P5-DOM-002` Authorization
- [ ] `P5-DOM-003` Session and CSRF
- [ ] `P5-DOM-004` Tenant isolation
- [ ] `P5-DOM-005` XSS and output safety
- [ ] `P5-DOM-006` Injection and DB query safety
- [ ] `P5-DOM-007` External HTTP/integration safety
- [ ] `P5-DOM-008` Logging and auditability
- [ ] `P5-DOM-009` Secure defaults
- [ ] `P5-DOM-010` Dependency hygiene

### Go/No-go
- [ ] `P5-GATE` Go only if critical/high security backlog is zero or explicitly risk-accepted.

## Phase 6 - Quality, Testing, and CI Gates

### Testing/quality tasks
- [ ] `P6-001` Build contract tests for API parity (legacy vs V2 where required).
- [ ] `P6-002` Add process-engine regression tests (transitions/effects/idempotency).
- [ ] `P6-003` Add frontend rendering and security regression checks.
- [ ] `P6-004` Expand CI beyond process-alignment script (lint/tests/security/migration checks).
- [ ] `P6-005` Add smoke suites for auth, product lifecycle, order/payment, and gateway flows.

### Go/No-go
- [ ] `P6-GATE` Go only if CI is a real release gate, not advisory.

## Phase 7 - Coexistence, Cutover, and Rollback

### Coexistence tasks
- [ ] `P7-001` Keep runtime switch and compatibility adapter for V1/V2 coexistence.
- [ ] `P7-002` Run shadow/parity execution against both paths for critical flows.
- [ ] `P7-003` Define canary cohort and monitoring thresholds.

### Cutover tasks
- [ ] `P7-004` Execute controlled canary rollout.
- [ ] `P7-005` Validate rollback drill (switch back to V1 path quickly and safely).
- [ ] `P7-006` Capture sign-offs from architecture/security/QA/operations.

### Go/No-go
- [ ] `P7-GATE` Go only if parity, performance, and rollback criteria are all met.

## Phase 8 - Post-Go-Live Stabilization

### Stabilization tasks
- [ ] `P8-001` Run enhanced monitoring window and incident playbook.
- [ ] `P8-002` Remove temporary compatibility shims on schedule.
- [ ] `P8-003` Archive or isolate deprecated V1-only artifacts per policy.
- [ ] `P8-004` Publish final V2 baseline and ongoing governance process.

### Completion gate
- [ ] `P8-GATE` Program complete only when V2 is stable and governance/test/security gates are operational.

## Top program risks (track continuously)
- [ ] `RISK-001` Copying drifted V1 lifecycle logic into V2.
- [ ] `RISK-002` Reintroducing tenant-specific hardcoding into shared modules.
- [ ] `RISK-003` Treating placeholder migrations as production-ready.
- [ ] `RISK-004` Incomplete security gates before canary.
- [ ] `RISK-005` Incomplete parity validation before cutover.
