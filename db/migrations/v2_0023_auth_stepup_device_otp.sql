BEGIN;

CREATE TABLE IF NOT EXISTS eip_auth.auth_device (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    device_kind text NOT NULL DEFAULT 'browser',
    device_token_hash text NOT NULL,
    trust_state text NOT NULL DEFAULT 'untrusted',
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT auth_device_kind_ck CHECK (device_kind IN ('browser')),
    CONSTRAINT auth_device_trust_state_ck CHECK (trust_state IN ('untrusted', 'trusted', 'revoked')),
    CONSTRAINT auth_device_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object'),
    CONSTRAINT auth_device_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES kernel.tenants (tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT auth_device_identity_fk FOREIGN KEY (tenant_id, identity_id)
        REFERENCES eip_auth.auth_identity (tenant_id, id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_device_identity_token_uk
    ON eip_auth.auth_device (tenant_id, identity_id, device_kind, device_token_hash);

CREATE INDEX IF NOT EXISTS auth_device_trust_lookup_idx
    ON eip_auth.auth_device (tenant_id, identity_id, trust_state, last_seen_at DESC);

COMMENT ON TABLE eip_auth.auth_device IS
  'Tenant-scoped device trust registry used for browser session binding and trusted-device policy.';
COMMENT ON COLUMN eip_auth.auth_device.device_token_hash IS
  'Hash of the browser device token cookie using auth pepper. Raw token is never stored.';

CREATE TABLE IF NOT EXISTS eip_auth.auth_otp_challenge (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    channel text NOT NULL DEFAULT 'email',
    otp_hash text NOT NULL,
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempt_count integer NOT NULL DEFAULT 6,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    is_consumed boolean NOT NULL DEFAULT false,
    ip_address inet,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT auth_otp_channel_ck CHECK (channel IN ('email')),
    CONSTRAINT auth_otp_attempt_count_ck CHECK (attempt_count >= 0),
    CONSTRAINT auth_otp_max_attempt_count_ck CHECK (max_attempt_count >= 1),
    CONSTRAINT auth_otp_expiry_ck CHECK (expires_at > created_at),
    CONSTRAINT auth_otp_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object'),
    CONSTRAINT auth_otp_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES kernel.tenants (tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT auth_otp_identity_fk FOREIGN KEY (tenant_id, identity_id)
        REFERENCES eip_auth.auth_identity (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS auth_otp_active_lookup_idx
    ON eip_auth.auth_otp_challenge (tenant_id, identity_id, is_consumed, expires_at DESC);

CREATE INDEX IF NOT EXISTS auth_otp_challenge_lookup_idx
    ON eip_auth.auth_otp_challenge (id, tenant_id, identity_id);

COMMENT ON TABLE eip_auth.auth_otp_challenge IS
  'Email OTP challenge state for pre-session step-up authentication.';
COMMENT ON COLUMN eip_auth.auth_otp_challenge.otp_hash IS
  'Hash of OTP + challenge id + auth otp pepper. Raw OTP is never stored.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'eip_auth'
      AND table_name = 'auth_session'
      AND constraint_name = 'auth_session_device_fk'
  ) THEN
    ALTER TABLE eip_auth.auth_session
      ADD CONSTRAINT auth_session_device_fk
      FOREIGN KEY (device_id)
      REFERENCES eip_auth.auth_device (id)
      ON DELETE SET NULL;
  END IF;
END
$$;

COMMIT;
