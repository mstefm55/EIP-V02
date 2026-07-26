# V2 Migration Checklist

## Purpose

Use this checklist before merging or replaying any V2 database change.

## No-Destructive-Command Policy

- Do not use destructive commands as part of normal migration authoring or validation.
- Do not rely on `DROP DATABASE`, `DROP SCHEMA`, `TRUNCATE`, or ad hoc data wiping to simulate rollback.
- Do not use clone shortcuts to bypass the authoritative migration chain.
- If a fresh state is needed, use a new environment or a clean restore path instead of destructive cleanup.

## Replay Expectations

- Every migration should replay cleanly in filename order from a fresh database.
- The executable chain is authoritative; the consolidated delta draft is only a planning aid.
- The migration runner must consult `eip_core.schema_migration` before executing a file.
- Applied migrations are skipped only when filename and SHA-256 checksum match the ledger.
- A filename with a changed checksum is a hard failure; do not edit applied migration files.
- Replays should be validated against the canonical `pg_dump` / `pg_restore` baseline.
- Stable filenames must remain monotonic and reviewable.
- If a migration depends on session state, that dependency must be documented.
- Baseline mode is only for existing environments that were migrated before the ledger existed, and it must verify V2 foundation objects before recording rows.

## Rollback Expectations

- Prefer restore-and-replay over manual schema surgery.
- If a migration is not directly reversible, document that clearly.
- Rollback notes should state whether a restore from the canonical baseline is required.
- If a change is additive-only, the rollback path may be "restore to a fresh database and replay to the desired point."

## Pre-Merge Checks

- Confirm the migration file is inside the V2-owned migration path.
- Confirm the change is additive and auditable.
- Confirm tenant-owned tables carry `tenant_id`.
- Confirm unique constraints and indexes respect tenant scope.
- Confirm RLS-ready tables have explicit policies or a documented reason for deferral.
- Confirm the clone strategy remains `pg_dump` / `pg_restore` for canonical rebuilds.
- Confirm each new or proposed table has a register entry in `docs/db/NEW_TABLE_JUSTIFICATION_REGISTER.md`.
- Confirm each table entry states why existing governed structures are insufficient.
- Confirm each table entry states whether it is foundational or feature-specific, and whether it is mandatory now or deferred.
- Confirm each table entry explicitly passes these checks:
  - no undermining of the service object kernel concept
  - no bypass of the process/task/effect model
  - no hardcoded business-specific workflow drift

## Evidence To Keep

- Migration file names and order
- Migration ledger rows and checksums
- Validation queries for schema existence and policy shape
- Rollback note or restore requirement
- Any portability note needed for future BRIDGE or SILO deployment modes
- Updated table register entries for all new/proposed tables
