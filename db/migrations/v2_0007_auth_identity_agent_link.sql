BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS eip_auth.auth_identity_agent (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE CASCADE,
    identity_id uuid NOT NULL,
    agent_id uuid NOT NULL REFERENCES eip_core.agent (id) ON DELETE CASCADE,
    is_primary boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT auth_identity_agent_identity_fk FOREIGN KEY (tenant_id, identity_id)
      REFERENCES eip_auth.auth_identity (tenant_id, id)
      ON DELETE CASCADE,
    CONSTRAINT auth_identity_agent_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_identity_agent_unique
    ON eip_auth.auth_identity_agent (tenant_id, identity_id, agent_id);

CREATE UNIQUE INDEX IF NOT EXISTS auth_identity_agent_primary_unique
    ON eip_auth.auth_identity_agent (tenant_id, identity_id)
    WHERE is_primary = true AND is_active = true;

CREATE INDEX IF NOT EXISTS auth_identity_agent_lookup_idx
    ON eip_auth.auth_identity_agent (tenant_id, identity_id, is_primary, is_active);

COMMENT ON TABLE eip_auth.auth_identity_agent IS
  'Optional mapping from auth identities to eip_core agents, used by process engine actor attribution without weakening transaction safety.';

COMMIT;
