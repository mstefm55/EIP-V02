# DB Clone and Delta Plan

## Purpose

Define how the V2 database baseline is created, how clones are produced safely, and how schema deltas are tracked from the start of the V2 chain.

## Recommended Path

Use a hybrid setup:

- `pg_dump` / `pg_restore` for the canonical baseline and any repeatable rebuild.
- `CREATE DATABASE ... TEMPLATE ...` for fast local or ephemeral cloning only.
- `v2_####` migrations for all forward schema changes.

This is the best mix of safety, portability, and iteration speed.

## Tenancy Target

V2 defaults to POOL tenancy.

- POOL keeps one shared database and one logical kernel.
- Every tenant-owned table carries `tenant_id`.
- BRIDGE and SILO remain future deployment modes that should reuse the same logical schema and migration chain.
- The kernel should not need a rewrite when deployment mode changes; only placement, routing, and operational boundaries should change.

## Clone Decision Matrix

### Preferred baseline method: `pg_dump` / `pg_restore`

Use for:

- CI rebuilds
- staging refreshes
- canonical V2 snapshots
- any clone that needs to be portable or reviewable

Why:

- logical, explicit, and repeatable
- safer than file-level cloning
- works across environments more predictably than template copy

### Fast local clone method: `CREATE DATABASE ... TEMPLATE ...`

Use for:

- local developer databases
- short-lived test clones
- throwaway sandboxes

Why:

- much faster than dump/restore
- simple to invoke
- useful when you need many repeated copies

Safety notes:

- the template database must be idle
- active sessions can block the clone
- the clone is exact, including mistakes and any accidental residual state
- do not use it as the only rebuild mechanism

## V2 Delta Strategy

The V2 delta should be tracked in two layers:

1. A consolidated draft that shows the intended schema shape and section order.
2. Small executable migrations that apply the delta in safe steps.

The draft is not a substitute for the migration chain. It is a planning and review artifact.

## Migration Sequencing

Use the following sequence for V2:

1. `v2_0001_kernel_bootstrap.sql`
2. `v2_0002_security_memberships.sql`
3. `v2_0003_tenant_settings_rls.sql`

Additional migrations continue the same prefix and numbering stream.

## Delta Breakdown

The consolidated delta draft should be organized into explicit sections:

1. Purpose and scope
2. Baseline assumptions
3. Tenancy model and portability notes
4. Schema namespaces and kernel anchors
5. Security primitives and membership model
6. Tenant-owned bootstrap tables
7. Foreign keys, constraints, and indexes
8. RLS helpers and policies
9. JSONB governance
10. Seed and reference data
11. Verification queries
12. Rollback or re-run notes

## Operational Rules

- Keep the source template pristine before template-based cloning.
- Prefer logical backups for any environment that may need to be rebuilt later.
- Keep V2 deltas additive first.
- Do not backfill the V2 chain into V1 numbering.
- Do not introduce extra tables unless the delta cannot be expressed through existing governed structures.
- Every new or proposed table must be recorded in `docs/db/NEW_TABLE_JUSTIFICATION_REGISTER.md`.

## Safety Implications

### Template clone

- Fastest option
- Highest risk if the source is live
- Best only when the source is frozen and under tight control

### Dump/restore

- Slower
- Safer for production-like environments
- More portable and easier to audit

### V2 migration chain

- Authoritative record of schema evolution
- Supports review, replay, and controlled rollout
- Prevents the clone method from becoming the real schema history

## Deliverable Standard

Every new V2 database change should answer these questions before it is accepted:

- Which migration file owns the change?
- Is the change additive?
- Can it be replayed safely?
- Does the delta draft still match the executable migrations?
- Is the clone method safe for the environment where it will be used?
