BEGIN;

-- EIP Core V2 — governed Connection Management control-plane foundation.
--
-- Profiles intentionally reuse tenant.tenant_settings using keys:
--   connection.profile.<connection_code>
--
-- Only encrypted credential material receives a dedicated table because general
-- tenant configuration and identity-bound eip_auth.auth_credential are both
-- insufficient for independent connection-secret rotation/revocation lifecycle.
-- owner_connections remains disabled until API + UI contracts pass release gates.

CREATE TABLE IF NOT EXISTS tenant.connection_secret (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE CASCADE,
    connection_code text NOT NULL,
    secret_kind text NOT NULL,
    version integer NOT NULL,
    status text NOT NULL DEFAULT 'active',
    algorithm text NOT NULL DEFAULT 'aes-256-gcm',
    key_id text NOT NULL,
    iv_b64 text NOT NULL,
    auth_tag_b64 text NOT NULL,
    ciphertext_b64 text NOT NULL,
    fingerprint text NOT NULL,
    rotated_from_id uuid REFERENCES tenant.connection_secret (id) ON DELETE SET NULL,
    rotated_by_identity_id uuid,
    revoked_at timestamptz,
    revoked_by_identity_id uuid,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT connection_secret_code_not_blank_ck CHECK (btrim(connection_code) <> ''),
    CONSTRAINT connection_secret_kind_not_blank_ck CHECK (btrim(secret_kind) <> ''),
    CONSTRAINT connection_secret_version_positive_ck CHECK (version > 0),
    CONSTRAINT connection_secret_status_ck CHECK (status IN ('active', 'superseded', 'revoked')),
    CONSTRAINT connection_secret_algorithm_ck CHECK (algorithm = 'aes-256-gcm'),
    CONSTRAINT connection_secret_key_id_not_blank_ck CHECK (btrim(key_id) <> ''),
    CONSTRAINT connection_secret_iv_not_blank_ck CHECK (btrim(iv_b64) <> ''),
    CONSTRAINT connection_secret_tag_not_blank_ck CHECK (btrim(auth_tag_b64) <> ''),
    CONSTRAINT connection_secret_ciphertext_not_blank_ck CHECK (btrim(ciphertext_b64) <> ''),
    CONSTRAINT connection_secret_fingerprint_not_blank_ck CHECK (btrim(fingerprint) <> ''),
    CONSTRAINT connection_secret_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object'),
    CONSTRAINT connection_secret_revoked_ts_ck CHECK (
      (status = 'revoked' AND revoked_at IS NOT NULL)
      OR (status <> 'revoked')
    ),
    CONSTRAINT connection_secret_identity_rotate_fk FOREIGN KEY (tenant_id, rotated_by_identity_id)
      REFERENCES eip_auth.auth_identity (tenant_id, id)
      ON DELETE SET NULL,
    CONSTRAINT connection_secret_identity_revoke_fk FOREIGN KEY (tenant_id, revoked_by_identity_id)
      REFERENCES eip_auth.auth_identity (tenant_id, id)
      ON DELETE SET NULL,
    CONSTRAINT connection_secret_version_uk UNIQUE (tenant_id, connection_code, secret_kind, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS connection_secret_one_active_uk
  ON tenant.connection_secret (tenant_id, connection_code, secret_kind)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS connection_secret_lookup_idx
  ON tenant.connection_secret (tenant_id, connection_code, secret_kind, status, version DESC);

CREATE INDEX IF NOT EXISTS connection_secret_updated_idx
  ON tenant.connection_secret (tenant_id, updated_at DESC);

ALTER TABLE tenant.connection_secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.connection_secret FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connection_secret_select_isolation ON tenant.connection_secret;
DROP POLICY IF EXISTS connection_secret_insert_isolation ON tenant.connection_secret;
DROP POLICY IF EXISTS connection_secret_update_isolation ON tenant.connection_secret;
DROP POLICY IF EXISTS connection_secret_delete_isolation ON tenant.connection_secret;

CREATE POLICY connection_secret_select_isolation
  ON tenant.connection_secret
  FOR SELECT
  USING (tenant_id = security.current_tenant_id());

CREATE POLICY connection_secret_insert_isolation
  ON tenant.connection_secret
  FOR INSERT
  WITH CHECK (tenant_id = security.current_tenant_id());

CREATE POLICY connection_secret_update_isolation
  ON tenant.connection_secret
  FOR UPDATE
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());

-- Deliberately no DELETE policy. Secret history is lifecycle-managed through
-- superseded/revoked status and must not be silently destroyed by application traffic.

COMMENT ON TABLE tenant.connection_secret IS
  'Tenant-owned encrypted connection credentials. FORCE RLS is enabled from creation; plaintext is never stored in this table or returned to UI clients.';
COMMENT ON COLUMN tenant.connection_secret.connection_code IS
  'Stable connection profile code matching tenant.tenant_settings key connection.profile.<code>.';
COMMENT ON COLUMN tenant.connection_secret.secret_kind IS
  'Governed CONNECTION_SECRET_KIND code. Runtime validation resolves allowed kinds from metadata.';
COMMENT ON COLUMN tenant.connection_secret.ciphertext_b64 IS
  'AES-256-GCM ciphertext only. Never project this column through client DTOs.';
COMMENT ON COLUMN tenant.connection_secret.fingerprint IS
  'Non-secret SHA-256 fingerprint used for safe change/audit comparison.';

-- ---------------------------------------------------------------------------
-- Governed Connection Management taxonomy.
-- ---------------------------------------------------------------------------

WITH list_defs(module, code, name, attrs) AS (
  VALUES
    ('integration', 'CONNECTION_KIND', 'Connection Kind', '{"ui":{"applies_to":["connection.identity.connection_kind"]}}'::jsonb),
    ('integration', 'CONNECTION_DIRECTION', 'Connection Direction', '{"ui":{"applies_to":["connection.identity.direction"]}}'::jsonb),
    ('integration', 'CONNECTION_ENVIRONMENT', 'Connection Environment', '{"ui":{"applies_to":["connection.identity.environment"]}}'::jsonb),
    ('integration', 'CONNECTION_VERIFICATION_MODE', 'Connection Verification Mode', '{"ui":{"applies_to":["connection.verification.mode"]}}'::jsonb),
    ('integration', 'CONNECTION_AUTH_MODE', 'Connection Authentication Mode', '{"ui":{"applies_to":["connection.outbound.auth_mode"]}}'::jsonb),
    ('integration', 'CONNECTION_CHANNEL', 'Connection Routing Channel', '{"ui":{"applies_to":["connection.routing.channel"]}}'::jsonb),
    ('integration', 'CONNECTION_MAPPING_MODE', 'Connection Mapping Mode', '{"ui":{"applies_to":["connection.routing.mapping_mode"]}}'::jsonb),
    ('integration', 'CONNECTION_HTTP_METHOD', 'Connection HTTP Method', '{"ui":{"applies_to":["connection.inbound.http_method","connection.outbound.test_request_method"]}}'::jsonb),
    ('integration', 'CONNECTION_LOG_LEVEL', 'Connection Log Level', '{"ui":{"applies_to":["connection.audit.log_level"]}}'::jsonb),
    ('integration', 'CONNECTION_SECRET_KIND', 'Connection Secret Kind', '{"security":{"secret":true},"ui":{"applies_to":["connection.credentials"]}}'::jsonb)
), upserted AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  SELECT NULL, module, code, name, 1, true, attrs
  FROM list_defs
  ON CONFLICT (tenant_id, module, code, version) DO UPDATE
  SET name = EXCLUDED.name,
      is_active = true,
      attrs = EXCLUDED.attrs,
      updated_at = now()
  RETURNING id, code
)
SELECT count(*) FROM upserted;

WITH value_defs(list_code, code, label, sort_order, attrs) AS (
  VALUES
    ('CONNECTION_KIND', 'website', 'Website', 10, '{}'::jsonb),
    ('CONNECTION_KIND', 'ecommerce', 'E-commerce', 20, '{}'::jsonb),
    ('CONNECTION_KIND', 'payments', 'Payments', 30, '{}'::jsonb),
    ('CONNECTION_KIND', 'banking', 'Banking', 40, '{}'::jsonb),
    ('CONNECTION_KIND', 'edi', 'EDI', 50, '{}'::jsonb),
    ('CONNECTION_KIND', 'social', 'Social', 60, '{}'::jsonb),
    ('CONNECTION_KIND', 'email', 'Email', 70, '{}'::jsonb),
    ('CONNECTION_KIND', 'custom', 'Custom', 90, '{}'::jsonb),

    ('CONNECTION_DIRECTION', 'inbound', 'Inbound', 10, '{}'::jsonb),
    ('CONNECTION_DIRECTION', 'outbound', 'Outbound', 20, '{}'::jsonb),
    ('CONNECTION_DIRECTION', 'both', 'Both', 30, '{}'::jsonb),

    ('CONNECTION_ENVIRONMENT', 'sandbox', 'Sandbox', 10, '{}'::jsonb),
    ('CONNECTION_ENVIRONMENT', 'production', 'Production', 20, '{}'::jsonb),

    ('CONNECTION_VERIFICATION_MODE', 'none', 'None', 10, '{"security":{"production_allowed":false}}'::jsonb),
    ('CONNECTION_VERIFICATION_MODE', 'api_key', 'API Key', 20, '{}'::jsonb),
    ('CONNECTION_VERIFICATION_MODE', 'hmac_signature', 'HMAC Signature', 30, '{}'::jsonb),
    ('CONNECTION_VERIFICATION_MODE', 'oauth2_jwt', 'OAuth2 JWT', 40, '{}'::jsonb),

    ('CONNECTION_AUTH_MODE', 'none', 'None', 10, '{}'::jsonb),
    ('CONNECTION_AUTH_MODE', 'bearer', 'Bearer Token', 20, '{}'::jsonb),
    ('CONNECTION_AUTH_MODE', 'api_key_header', 'API Key Header', 30, '{}'::jsonb),
    ('CONNECTION_AUTH_MODE', 'api_key_query', 'API Key Query', 40, '{}'::jsonb),
    ('CONNECTION_AUTH_MODE', 'basic', 'Basic Authentication', 50, '{}'::jsonb),
    ('CONNECTION_AUTH_MODE', 'oauth2_client_credentials', 'OAuth2 Client Credentials', 60, '{}'::jsonb),

    ('CONNECTION_CHANNEL', 'website_intake', 'Website Intake', 10, '{}'::jsonb),
    ('CONNECTION_CHANNEL', 'edi', 'EDI', 20, '{}'::jsonb),
    ('CONNECTION_CHANNEL', 'banking', 'Banking', 30, '{}'::jsonb),
    ('CONNECTION_CHANNEL', 'payments', 'Payments', 40, '{}'::jsonb),
    ('CONNECTION_CHANNEL', 'social', 'Social', 50, '{}'::jsonb),
    ('CONNECTION_CHANNEL', 'email', 'Email', 60, '{}'::jsonb),
    ('CONNECTION_CHANNEL', 'custom', 'Custom', 90, '{}'::jsonb),

    ('CONNECTION_MAPPING_MODE', 'passthrough', 'Passthrough', 10, '{}'::jsonb),
    ('CONNECTION_MAPPING_MODE', 'mapped', 'Mapped', 20, '{}'::jsonb),

    ('CONNECTION_HTTP_METHOD', 'GET', 'GET', 10, '{}'::jsonb),
    ('CONNECTION_HTTP_METHOD', 'POST', 'POST', 20, '{}'::jsonb),
    ('CONNECTION_HTTP_METHOD', 'PUT', 'PUT', 30, '{}'::jsonb),
    ('CONNECTION_HTTP_METHOD', 'PATCH', 'PATCH', 40, '{}'::jsonb),
    ('CONNECTION_HTTP_METHOD', 'HEAD', 'HEAD', 50, '{}'::jsonb),

    ('CONNECTION_LOG_LEVEL', 'error', 'Error', 10, '{}'::jsonb),
    ('CONNECTION_LOG_LEVEL', 'warn', 'Warning', 20, '{}'::jsonb),
    ('CONNECTION_LOG_LEVEL', 'info', 'Info', 30, '{}'::jsonb),
    ('CONNECTION_LOG_LEVEL', 'debug', 'Debug', 40, '{}'::jsonb),

    ('CONNECTION_SECRET_KIND', 'api_key', 'API Key', 10, '{"secret":true}'::jsonb),
    ('CONNECTION_SECRET_KIND', 'hmac_secret', 'HMAC Secret', 20, '{"secret":true}'::jsonb),
    ('CONNECTION_SECRET_KIND', 'bearer_token', 'Bearer Token', 30, '{"secret":true}'::jsonb),
    ('CONNECTION_SECRET_KIND', 'basic_password', 'Basic Password', 40, '{"secret":true}'::jsonb),
    ('CONNECTION_SECRET_KIND', 'oauth_client_secret', 'OAuth Client Secret', 50, '{"secret":true}'::jsonb)
), lists AS (
  SELECT id, code
  FROM eip_core.dropdown_list
  WHERE tenant_id IS NULL
    AND module = 'integration'
    AND version = 1
    AND is_active = true
    AND code IN (
      'CONNECTION_KIND',
      'CONNECTION_DIRECTION',
      'CONNECTION_ENVIRONMENT',
      'CONNECTION_VERIFICATION_MODE',
      'CONNECTION_AUTH_MODE',
      'CONNECTION_CHANNEL',
      'CONNECTION_MAPPING_MODE',
      'CONNECTION_HTTP_METHOD',
      'CONNECTION_LOG_LEVEL',
      'CONNECTION_SECRET_KIND'
    )
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT lists.id, value_defs.code, value_defs.label, value_defs.sort_order, true, value_defs.attrs
FROM value_defs
JOIN lists ON lists.code = value_defs.list_code
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = true,
    attrs = EXCLUDED.attrs,
    updated_at = now();

COMMIT;
