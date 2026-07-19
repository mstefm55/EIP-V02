# V2 DB Strategy

## Decision
Recommended strategy: **hybrid**.

Use a new V2 migration chain as the authoritative evolution path, and use clone or dump/restore only as bootstrap mechanisms depending on the environment:

- `pg_dump`/`pg_restore` for the canonical, portable baseline and any repeatable environment rebuild.
- `CREATE DATABASE ... TEMPLATE ...` only for fast local or ephemeral developer clones when the source database is quiescent and safe to copy.
- A brand-new V2 migration numbering stream for all V2 schema work. Do not continue any V1 numbering.

## Tenancy Model

Default V2 tenancy is **POOL**.

- POOL means one shared database with tenant-owned rows carrying `tenant_id`.
- BRIDGE and SILO remain future deployment modes, not separate kernel designs.
- The logical schema, migration chain, and tenant-scoping rules must stay portable across those modes.
- Any future move from POOL to BRIDGE or SILO should change placement and routing, not the kernel contract.

## Why This Strategy

This is the safest combination for V2 foundation work because it separates three concerns:

1. Baseline reproduction
2. Environment cloning speed
3. Forward schema change management

That gives us one authoritative V2 migration chain while still keeping local development and test spins fast where it is safe to do so.

## PostgreSQL Clone Method Notes

### `CREATE DATABASE ... TEMPLATE ...`

Use only when all of the following are true:

- The template database is frozen and not being written to.
- There are no active sessions on the template database.
- The copy stays within the same PostgreSQL cluster.
- The source and target are compatible at the storage level.

Safety implications:

- Very fast, because PostgreSQL copies the database files directly.
- Unsafe if the source database is live or if concurrent writes are possible.
- Can fail if the template database has active connections.
- Copies the database exactly as-is, including mistakes, leftover data, and any accidental state.

Best use:

- Local developer clones
- Ephemeral test databases
- Short-lived sandboxes where speed matters more than portability

### `pg_dump` / `pg_restore`

Use when you need a repeatable or portable baseline.

Safety implications:

- Slower than template cloning, but much safer for controlled rebuilds.
- Portable across clusters and easier to move between environments.
- Better for repeatable baselines, CI bootstrap, and environment refreshes.
- Produces an explicit logical backup rather than copying live database files.

Best use:

- Canonical V2 foundation baseline
- Staging/CI rebuilds
- Any clone path that must be versionable, reviewable, and repeatable

## V2 Numbering Scheme

Use a new prefix namespace for V2 migrations:

- File pattern: `v2_0001_<slug>.sql`
- Padding: 4 digits, zero-padded
- Order: strictly increasing by filename prefix
- Scope: V2 only, never appended to V1

Examples:

- `v2_0001_kernel_bootstrap.sql`
- `v2_0002_security_memberships.sql`
- `v2_0003_tenant_settings_rls.sql`

Rules:

- Never reuse V1 migration numbers.
- Never mix V1 and V2 numbering in the same stream.
- If a migration needs to be superseded, add a new V2 file instead of renumbering history.

## V2 Foundation Plan

1. Establish the V2 clone/baseline method.
2. Land the new V2 migration chain starting at `v2_0001`.
3. Keep the tenancy model, tenant rules, and migration checklist documented alongside the schema work.
4. Keep one consolidated delta draft in `db/sql` so the intended schema deltas are visible before they are fully decomposed.
5. Convert the delta draft into executable migrations in order, with replay safety and clear rollback notes.

## Table Creation Authority Rule

- V2 does not create new tables by default.
- A new table is allowed only when existing governed structures are insufficient and the table is clearly required for at least one of:
  - kernel integrity
  - engine integrity
  - tenant isolation
  - security hardening
  - migration authority
- Every new or proposed table must be recorded in `docs/db/NEW_TABLE_JUSTIFICATION_REGISTER.md`.
- If the justification is weak, the table must be deferred and not created.

## Safety Rules

- Do not run destructive database commands as part of the foundation work.
- Do not mutate the source template database while treating it as a clone source.
- Do not rely on physical copy behavior for long-term portability.
- Do not use a clone shortcut to bypass the V2 migration chain.

## Result

This hybrid approach gives V2 a stable baseline, fast local developer cloning where safe, and a clean migration history that can evolve independently from V1.
