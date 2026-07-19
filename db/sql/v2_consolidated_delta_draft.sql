-- V2 Consolidated Delta Draft
-- Status: structured draft
-- Purpose: define the first V2 schema delta at a reviewable level before
--          decomposing it into executable migrations.

-- SECTION 00: Scope
-- - V2 only
-- - No continuation of V1 numbering
-- - No destructive operations
-- - Additive-first schema change policy

-- SECTION 01: Baseline Assumptions
-- - The authoritative V2 chain begins at v2_0001
-- - Clone behavior is an implementation detail, not the source of truth
-- - Logical rebuilds must remain possible
-- - Default tenancy is POOL, with BRIDGE/SILO preserved as future portability modes

-- SECTION 02: Target Schema Namespaces and Kernel Anchors
-- - kernel: shared tenant registry and bootstrap metadata
-- - tenant: tenant-owned rows, always carrying tenant_id
-- - security: identity and membership primitives
-- - Keep the logical schema portable across POOL, BRIDGE, and SILO
-- - Do not introduce mode-specific kernel forks

-- SECTION 03: Tenancy Model
-- - POOL is the default V2 mode
-- - tenant_id remains the logical boundary in every mode
-- - BRIDGE and SILO alter placement and routing, not row semantics
-- - Current tenant context should be carried in app.current_tenant_id

-- SECTION 04: Core Tables
-- - kernel.tenants: tenant registry and tenancy_mode marker
-- - security.principals: global identity anchor
-- - security.tenant_memberships: tenant-scoped membership map
-- - tenant.tenant_settings: tenant-owned governed configuration
-- - eip_auth.auth_identity: tenant-scoped login identity anchor
-- - eip_auth.auth_credential: credential records for auth identity verification
-- - eip_auth.auth_session: cookie/session persistence for auth shell runtime

-- SECTION 05: Constraints, Foreign Keys, and Indexes
-- - kernel.tenants: unique tenant_code, status and tenancy_mode checks
-- - security.principals: unique principal_key and status checks
-- - security.tenant_memberships: composite primary key (tenant_id, principal_id, membership_role)
-- - tenant.tenant_settings: composite uniqueness on (tenant_id, setting_key)
-- - Indexes should start with tenant_id where the table is tenant-scoped
-- - Global uniqueness is allowed only when the value is truly cross-tenant

-- SECTION 06: RLS Helpers and Policies
-- - security.current_tenant_id() reads app.current_tenant_id
-- - tenant-scoped tables enable row level security
-- - Policies deny by default when tenant context is absent
-- - Policies must use both USING and WITH CHECK for write safety

-- SECTION 07: JSONB Governance
-- - Keep core identity, scope, and ownership fields relational
-- - JSONB is allowed only for governed payloads
-- - setting_value in tenant.tenant_settings must be an object
-- - Add JSONB indexes only after a real query pattern is proven

-- SECTION 08: Seed and Reference Data
-- - Seed rows must be tenant-neutral unless they are a deliberate tenant bootstrap record
-- - Reference data should be reviewable and idempotent
-- - Keep bootstrap data separate from application fixtures

-- SECTION 09: Validation Queries
-- - Confirm schemas exist
-- - Confirm tenant and security tables exist
-- - Confirm RLS is enabled on tenant-owned tables
-- - Confirm current tenant context returns null when unset
-- - Confirm scoped uniqueness and tenant-local indexes

-- SECTION 10: Rollback and Re-run Notes
-- - Additive migrations should be replayed into a fresh database
-- - Do not use ad hoc destructive cleanup to simulate rollback
-- - If a change is not directly reversible, require restore/replay from the canonical baseline

-- SECTION 11: Decomposition Notes
-- - Break this draft into one executable migration per coherent unit
-- - Keep filenames in the v2_#### namespace
-- - The stable chain currently maps to v2_0001_kernel_bootstrap.sql,
--   v2_0002_security_memberships.sql, v2_0003_tenant_settings_rls.sql,
--   and v2_0004_auth_shell_foundation.sql
-- - Update this draft as additional migrations are carved out
