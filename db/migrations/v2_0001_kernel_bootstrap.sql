BEGIN;

CREATE SCHEMA IF NOT EXISTS kernel;
CREATE SCHEMA IF NOT EXISTS tenant;
CREATE SCHEMA IF NOT EXISTS security;

COMMENT ON SCHEMA kernel IS 'Shared V2 kernel objects, tenancy registry, and bootstrap metadata.';
COMMENT ON SCHEMA tenant IS 'Tenant-owned data. Every row in this schema must carry tenant_id and be RLS-ready.';
COMMENT ON SCHEMA security IS 'Identity, membership, and access-control primitives for V2.';

CREATE OR REPLACE FUNCTION security.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION security.current_tenant_id() IS
  'Returns the current tenant context from app.current_tenant_id; null means tenant-scoped access should fail closed.';

CREATE TABLE IF NOT EXISTS kernel.tenants (
    tenant_id uuid PRIMARY KEY,
    tenant_code text NOT NULL,
    tenant_name text NOT NULL,
    tenancy_mode text NOT NULL DEFAULT 'POOL',
    tenant_status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kernel_tenants_tenant_code_uk UNIQUE (tenant_code),
    CONSTRAINT kernel_tenants_tenancy_mode_ck CHECK (tenancy_mode IN ('POOL', 'BRIDGE', 'SILO')),
    CONSTRAINT kernel_tenants_status_ck CHECK (tenant_status IN ('active', 'suspended', 'closed')),
    CONSTRAINT kernel_tenants_code_not_blank CHECK (btrim(tenant_code) <> ''),
    CONSTRAINT kernel_tenants_name_not_blank CHECK (btrim(tenant_name) <> '')
);

CREATE INDEX IF NOT EXISTS kernel_tenants_status_idx
    ON kernel.tenants (tenant_status);

CREATE INDEX IF NOT EXISTS kernel_tenants_mode_status_idx
    ON kernel.tenants (tenancy_mode, tenant_status);

COMMENT ON TABLE kernel.tenants IS
  'Canonical tenant registry. tenancy_mode defaults to POOL; BRIDGE and SILO are portability targets, not a kernel rewrite.';
COMMENT ON COLUMN kernel.tenants.tenant_id IS
  'Immutable tenant surrogate key used as the anchor for all tenant-scoped data.';
COMMENT ON COLUMN kernel.tenants.tenancy_mode IS
  'Deployment model marker. The logical schema stays the same across POOL, BRIDGE, and SILO.';

CREATE TABLE IF NOT EXISTS security.principals (
    principal_id uuid PRIMARY KEY,
    principal_key text NOT NULL,
    principal_kind text NOT NULL,
    principal_name text NOT NULL,
    principal_status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT security_principals_key_uk UNIQUE (principal_key),
    CONSTRAINT security_principals_kind_ck CHECK (principal_kind IN ('user', 'service', 'system')),
    CONSTRAINT security_principals_status_ck CHECK (principal_status IN ('active', 'locked', 'disabled')),
    CONSTRAINT security_principals_key_not_blank CHECK (btrim(principal_key) <> ''),
    CONSTRAINT security_principals_name_not_blank CHECK (btrim(principal_name) <> '')
);

CREATE INDEX IF NOT EXISTS security_principals_kind_status_idx
    ON security.principals (principal_kind, principal_status);

COMMENT ON TABLE security.principals IS
  'Global identity anchor for users, services, and system actors. This table is shared control-plane data, not tenant-owned business data.';
COMMENT ON COLUMN security.principals.principal_key IS
  'Canonical principal identifier. Keep it stable across auth providers and deployment modes.';

COMMIT;
