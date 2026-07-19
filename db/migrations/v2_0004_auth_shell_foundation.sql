BEGIN;

CREATE SCHEMA IF NOT EXISTS eip_auth;

COMMENT ON SCHEMA eip_auth IS
  'V2 authentication/session persistence for the shared auth shell.';

CREATE TABLE IF NOT EXISTS eip_auth.auth_identity (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    login text NOT NULL,
    login_type text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    is_locked boolean NOT NULL DEFAULT false,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT auth_identity_login_type_ck CHECK (login_type IN ('email', 'username', 'phone', 'external')),
    CONSTRAINT auth_identity_login_not_blank_ck CHECK (btrim(login) <> ''),
    CONSTRAINT auth_identity_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object'),
    CONSTRAINT auth_identity_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES kernel.tenants (tenant_id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_identity_tenant_login_uk
    ON eip_auth.auth_identity (tenant_id, lower(login));

CREATE UNIQUE INDEX IF NOT EXISTS auth_identity_tenant_id_uq
    ON eip_auth.auth_identity (tenant_id, id);

CREATE INDEX IF NOT EXISTS auth_identity_tenant_active_idx
    ON eip_auth.auth_identity (tenant_id, is_active, is_locked);

COMMENT ON TABLE eip_auth.auth_identity IS
  'Tenant-scoped login identities used by the V2 auth shell.';
COMMENT ON COLUMN eip_auth.auth_identity.attrs IS
  'Governed JSONB for identity metadata. Keep core ownership and status relational.';

CREATE TABLE IF NOT EXISTS eip_auth.auth_credential (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    credential_type text NOT NULL,
    secret_hash text,
    algorithm text,
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_to timestamptz,
    is_revoked boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT auth_credential_type_ck CHECK (credential_type IN ('password', 'totp', 'api_key', 'oidc')),
    CONSTRAINT auth_credential_meta_object_ck CHECK (jsonb_typeof(meta) = 'object'),
    CONSTRAINT auth_credential_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES kernel.tenants (tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT auth_credential_identity_fk FOREIGN KEY (tenant_id, identity_id)
        REFERENCES eip_auth.auth_identity (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS credential_lookup_idx
    ON eip_auth.auth_credential (
      tenant_id,
      identity_id,
      credential_type,
      is_revoked,
      valid_to,
      valid_from DESC,
      created_at DESC
    );

COMMENT ON TABLE eip_auth.auth_credential IS
  'Credential records for auth identities. Password verification reads active password rows from this table.';

CREATE TABLE IF NOT EXISTS eip_auth.auth_session (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    device_id uuid,
    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    refresh_token_hash text,
    csrf_secret_hash text,
    ip_address inet,
    user_agent_hash text,
    is_revoked boolean NOT NULL DEFAULT false,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT auth_session_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object'),
    CONSTRAINT auth_session_revoked_ts_ck CHECK (revoked_at IS NULL OR revoked_at >= issued_at),
    CONSTRAINT auth_session_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES kernel.tenants (tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT auth_session_identity_fk FOREIGN KEY (tenant_id, identity_id)
        REFERENCES eip_auth.auth_identity (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS session_lookup_idx
    ON eip_auth.auth_session (tenant_id, identity_id, is_revoked, expires_at);

CREATE INDEX IF NOT EXISTS auth_session_realm_idx
    ON eip_auth.auth_session (tenant_id, (attrs ->> 'realm'))
    WHERE attrs ? 'realm';

COMMENT ON TABLE eip_auth.auth_session IS
  'Session store for cookie-backed authentication in V2.';
COMMENT ON COLUMN eip_auth.auth_session.attrs IS
  'Session metadata including auth realm and additional governed runtime context.';

COMMIT;
