BEGIN;

CREATE TABLE IF NOT EXISTS security.tenant_memberships (
    tenant_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    membership_role text NOT NULL,
    membership_status text NOT NULL DEFAULT 'active',
    granted_by_principal_id uuid,
    granted_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT security_tenant_memberships_pk PRIMARY KEY (tenant_id, principal_id, membership_role),
    CONSTRAINT security_tenant_memberships_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES kernel.tenants (tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT security_tenant_memberships_principal_fk FOREIGN KEY (principal_id)
        REFERENCES security.principals (principal_id)
        ON DELETE CASCADE,
    CONSTRAINT security_tenant_memberships_granted_by_fk FOREIGN KEY (granted_by_principal_id)
        REFERENCES security.principals (principal_id)
        ON DELETE SET NULL,
    CONSTRAINT security_tenant_memberships_role_not_blank CHECK (btrim(membership_role) <> ''),
    CONSTRAINT security_tenant_memberships_status_ck CHECK (membership_status IN ('active', 'pending', 'revoked')),
    CONSTRAINT security_tenant_memberships_revoked_ts_ck CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE INDEX IF NOT EXISTS security_tenant_memberships_tenant_status_idx
    ON security.tenant_memberships (tenant_id, membership_status);

CREATE INDEX IF NOT EXISTS security_tenant_memberships_principal_status_idx
    ON security.tenant_memberships (principal_id, membership_status);

COMMENT ON TABLE security.tenant_memberships IS
  'Tenant-scoped membership map for access-control and ownership grants. tenant_id leads the primary key so uniqueness remains tenant-local.';
COMMENT ON COLUMN security.tenant_memberships.tenant_id IS
  'Tenant scope anchor. Every membership row is evaluated against the current tenant context when RLS is enabled.';

ALTER TABLE security.tenant_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY security_tenant_memberships_tenant_isolation
    ON security.tenant_memberships
    USING (tenant_id = security.current_tenant_id())
    WITH CHECK (tenant_id = security.current_tenant_id());

COMMIT;
