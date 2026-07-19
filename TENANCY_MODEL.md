# Tenancy Model

## Summary

V2 defaults to **POOL** tenancy.

- POOL means a shared database and a shared kernel.
- Tenant-owned rows always carry `tenant_id`.
- BRIDGE and SILO are future deployment modes, not separate schema families.
- The logical schema should remain portable across all three modes without a kernel rewrite.

## Mode Definitions

### POOL

- One logical database serves many tenants.
- Shared kernel tables define the tenant registry and security primitives.
- Tenant-owned tables are scoped by `tenant_id` and protected with RLS-ready policies.

### BRIDGE

- One logical kernel still serves the platform.
- Some operational boundaries may shift to dedicated bridge placements or routing layers.
- The row model stays tenant-aware, so portability is preserved.

### SILO

- One tenant may live in a dedicated database or cluster.
- The schema and table contracts remain the same.
- `tenant_id` still exists so code, audit, and tooling do not need a separate kernel model.

## Invariants

- `tenant_id` is mandatory on tenant-owned tables.
- Tenant-scoped uniqueness starts with `tenant_id`.
- Tenant-scoped indexes should start with `tenant_id`.
- RLS policies should fail closed when tenant context is missing.
- Shared control-plane tables may omit `tenant_id` only when they truly represent global registry or identity state.

## Session Tenant Context

- The canonical session variable is `app.current_tenant_id`.
- `security.current_tenant_id()` reads that value for RLS-ready queries and policies.
- Missing tenant context should deny access, not guess a tenant.

## What Changes Between Modes

- Placement
- Routing
- Backup and restore topology
- Operational ownership boundaries

What does not change:

- Logical schema
- Tenant-scoping rules
- Composite uniqueness rules
- RLS policy shape
- The authoritative V2 migration chain
