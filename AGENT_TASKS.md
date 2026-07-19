# AGENT_TASKS

## General rules
- Read `AGENTS.md` first.
- Do not modify files outside your ownership.
- If scope expands, stop and report the expansion.
- No two workers may modify the same files at the same time.
- Run relevant checks before finishing.

## Coordinator rule
- Coordinator owns planning, worker split, merge order, and conflict control.
- Coordinator should avoid direct edits unless explicitly assigned.

## Minimum execution split (V2 start order)

### Worker 1 - Governance and Canon
Owns:
- `AGENTS.md`
- `AGENT_TASKS.md`
- `README.md`
- `docs/codex/**`
- `docs/architecture/KERNEL_CANON.md`
- `docs/architecture/SERVICE_OBJECT_CANON.md`
- `docs/architecture/TASK_EFFECT_MODEL.md`

### Worker 2 - DB Kernel, Tenancy, and Migration Chain
Owns:
- `DB_V2_STRATEGY.md`
- `TENANCY_MODEL.md`
- `DB_TENANT_RULES.md`
- `docs/db/**`
- `docs/db/NEW_TABLE_JUSTIFICATION_REGISTER.md`
- `db/migrations/**`
- `db/sql/**`

### Worker 3 - API Contract and Security Shell
Owns:
- `services/api/**`
- `MIGRATION_STRATEGY.md`

### Worker 4 - Salvage and Port Order Control
Owns:
- `V1_V2_PARTITION.md`
- `REUSE_MATRIX.md`
- `docs/architecture/FRONTEND_SALVAGE_MAP.md`

### Worker 5 - Security Gates and Drift Controls
Owns:
- `SECURITY_TARGET.md`
- `SECURITY_CHECKLIST.md`
- `docs/architecture/SECURITY_CONTROL_FRAMEWORK.md`
- `docs/dev/BANNED_PATTERNS.md`
- `docs/dev/NO_MERGE_GATES.md`
- `scripts/validate_security_controls.mjs`
- `scripts/validate_tenant_scope.mjs`
- `.github/workflows/v2-security-governance-gates.yml`

## Required execution order
1. Governance and security lock
2. DB kernel + tenancy/security primitives
3. API contracts/security shell (parallel with DB continuation)
4. Stable V2 migration set
5. First V2 backend skeleton
6. Only then selective V1 salvage and ports

## Feature slot template
For each active feature, define:
- feature name
- worker owner
- allowed files
- forbidden files
- required checks
- merge order
