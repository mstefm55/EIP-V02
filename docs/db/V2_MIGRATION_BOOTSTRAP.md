# V2 Migration Bootstrap

## Goal

Create a clean starting point for V2 database work without continuing V1 history.

## Bootstrap Contract

The V2 bootstrap must satisfy three conditions:

1. The migration chain starts with a fresh V2 prefix.
2. The baseline clone method is explicit and environment-aware.
3. The schema delta plan is visible before it is fully implemented.

Default tenancy for V2 is POOL.

- Shared POOL storage is the starting point.
- BRIDGE and SILO are portability targets, not a second kernel.
- The migration chain and tenant rules must remain valid if deployment placement changes later.

## Numbering Scheme

Use this format for all V2 migrations:

- `v2_0001_<slug>.sql`
- `v2_0002_<slug>.sql`
- `v2_0003_<slug>.sql`

Rules:

- Start at `v2_0001`.
- Never continue a V1 sequence.
- Keep filenames monotonic and reviewable.
- Add new migrations instead of renumbering history.

## Bootstrap Order

1. Establish the V2 migration namespace.
2. Add the initial stable migrations in `db/migrations`.
3. Record the consolidated delta draft in `db/sql`.
4. Use the draft to break down real schema changes into executable steps.
5. Keep the tenancy model, tenant rules, and migration checklist in sync with the executable chain.

## Clone Method Guidance

### Use `CREATE DATABASE ... TEMPLATE ...` when:

- the source database is idle
- the source database is meant to be cloned as-is
- you need a quick local or ephemeral copy

### Use `pg_dump` / `pg_restore` when:

- you need a canonical baseline
- you need portability between environments
- you need repeatable rebuilds or CI bootstraps

## Safety Notes

- Do not use template cloning against a database that still has active sessions.
- Do not treat template cloning as a substitute for a recoverable baseline.
- Do not use destructive commands in the bootstrap workflow.
- Do not hide schema work inside clone scripts.

## Stable Migration Contract

Each initial V2 migration should be valid SQL, additive, and auditable.

Recommended structure:

- transaction boundary
- purpose comment
- explicit schema objects
- comments that explain tenancy and security intent

The chain should represent real bootstrap work, not placeholders or dead markers.

## Initial File Set

Recommended starter files:

- `db/migrations/v2_0001_kernel_bootstrap.sql`
- `db/migrations/v2_0002_security_memberships.sql`
- `db/migrations/v2_0003_tenant_settings_rls.sql`
- `db/sql/v2_consolidated_delta_draft.sql`
- `TENANCY_MODEL.md`
- `DB_TENANT_RULES.md`
- `docs/db/V2_MIGRATION_CHECKLIST.md`
- `docs/db/NEW_TABLE_JUSTIFICATION_REGISTER.md`

## Verification Checklist

- V2 starts at `v2_0001`.
- No V1 numbering is reused.
- The clone strategy is documented with safety implications.
- The delta draft is structured into exact sections.
- The migration files are stable SQL, not placeholders.
- The tenancy model is explicit, with POOL as the default and BRIDGE/SILO as future portability targets.
- Any new/proposed table has a register entry with explicit insufficiency rationale and drift checks.
