BEGIN;

-- Owner Admin completion foundation.
--
-- Two persistence gaps are intentionally closed here because they cannot be
-- represented truthfully by existing tenant-owned business rows:
--   1. pre-tenant access requests exist before a tenant can own them;
--   2. privileged Admin mutations require a durable, redacted control-plane
--      audit trail independent of mutable business objects.
--
-- No Process, Effect, Reasoning, Connection, organisation or workstation
-- engine/table is duplicated by this migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS kernel.tenant_request (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ref_code text NOT NULL UNIQUE,
    status_code text NOT NULL DEFAULT 'SUBMITTED',
    applicant_type text NOT NULL,
    legal_name text NOT NULL,
    business_reg_no text,
    personal_id_no text,
    email text NOT NULL,
    phone text,
    country text NOT NULL,
    timezone text NOT NULL,
    tenant_id uuid REFERENCES kernel.tenants (tenant_id) ON DELETE SET NULL,
    admin_identity_id uuid REFERENCES eip_auth.auth_identity (id) ON DELETE SET NULL,
    bootstrap_token_hash text,
    bootstrap_expires_at timestamptz,
    bootstrap_used_at timestamptz,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kernel_tenant_request_status_ck CHECK (
      status_code IN ('SUBMITTED', 'UNDER_REVIEW', 'BOOTSTRAP_PENDING', 'ACTIVE', 'REJECTED', 'EXPIRED')
    ),
    CONSTRAINT kernel_tenant_request_applicant_type_ck CHECK (
      applicant_type IN ('business', 'sole_trader')
    ),
    CONSTRAINT kernel_tenant_request_ref_not_blank_ck CHECK (btrim(ref_code) <> ''),
    CONSTRAINT kernel_tenant_request_name_not_blank_ck CHECK (btrim(legal_name) <> ''),
    CONSTRAINT kernel_tenant_request_email_not_blank_ck CHECK (btrim(email) <> ''),
    CONSTRAINT kernel_tenant_request_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS kernel_tenant_request_status_time_idx
  ON kernel.tenant_request (status_code, created_at DESC);

CREATE INDEX IF NOT EXISTS kernel_tenant_request_email_idx
  ON kernel.tenant_request (lower(email), created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS kernel_tenant_request_bootstrap_hash_uq
  ON kernel.tenant_request (bootstrap_token_hash)
  WHERE bootstrap_token_hash IS NOT NULL;

COMMENT ON TABLE kernel.tenant_request IS
  'Pre-tenant onboarding control-plane queue. Rows exist before tenant ownership and are therefore not stored as tenant business objects.';

CREATE TABLE IF NOT EXISTS security.audit_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid REFERENCES kernel.tenants (tenant_id) ON DELETE SET NULL,
    actor_identity_id uuid,
    event_code text NOT NULL,
    category text NOT NULL,
    severity text NOT NULL DEFAULT 'info',
    outcome text NOT NULL DEFAULT 'success',
    subject_kind text,
    subject_id text,
    summary text,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT security_audit_event_actor_fk FOREIGN KEY (tenant_id, actor_identity_id)
      REFERENCES eip_auth.auth_identity (tenant_id, id)
      ON DELETE SET NULL,
    CONSTRAINT security_audit_event_code_not_blank_ck CHECK (btrim(event_code) <> ''),
    CONSTRAINT security_audit_event_category_not_blank_ck CHECK (btrim(category) <> ''),
    CONSTRAINT security_audit_event_severity_ck CHECK (severity IN ('info', 'warning', 'critical')),
    CONSTRAINT security_audit_event_outcome_ck CHECK (outcome IN ('success', 'denied', 'failed')),
    CONSTRAINT security_audit_event_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS security_audit_event_tenant_time_idx
  ON security.audit_event (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS security_audit_event_code_time_idx
  ON security.audit_event (event_code, occurred_at DESC);

COMMENT ON TABLE security.audit_event IS
  'Redacted privileged control-plane audit events. Secret values and raw credentials must never be written to attrs.';

-- The current V2 runtime permission authority is the canonical permission-code
-- projection on auth_identity.attrs. Extend existing Owner Admin identities
-- forward rather than creating a competing role engine in this wave.
WITH admin_permissions AS (
  SELECT ARRAY[
    'OWNER_ADMIN_ACCESS_WRITE',
    'OWNER_ADMIN_SECURITY_WRITE',
    'OWNER_ADMIN_SETTINGS_WRITE',
    'OWNER_ADMIN_AUDIT_READ',
    'OWNER_ADMIN_SCHEMA_READ',
    'OWNER_ADMIN_TENANT_REQUEST_READ',
    'OWNER_ADMIN_TENANT_REQUEST_WRITE'
  ]::text[] AS codes
), eligible AS (
  SELECT identity.id,
         identity.tenant_id,
         COALESCE(identity.attrs, '{}'::jsonb) AS attrs,
         ARRAY(
           SELECT DISTINCT upper(btrim(value))
           FROM jsonb_array_elements_text(
             CASE
               WHEN jsonb_typeof(identity.attrs->'permissions') = 'array'
                 THEN identity.attrs->'permissions'
               ELSE '[]'::jsonb
             END
           ) AS p(value)
           WHERE btrim(value) <> ''
         ) AS current_codes
  FROM eip_auth.auth_identity AS identity
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(identity.attrs->'permissions') = 'array'
          THEN identity.attrs->'permissions'
        ELSE '[]'::jsonb
      END
    ) AS p(value)
    WHERE upper(btrim(value)) = 'OWNER_ADMIN_CONSOLE_READ'
  )
)
UPDATE eip_auth.auth_identity AS identity
SET attrs = jsonb_set(
      COALESCE(identity.attrs, '{}'::jsonb),
      '{permissions}',
      to_jsonb(
        ARRAY(
          SELECT DISTINCT code
          FROM unnest(eligible.current_codes || admin_permissions.codes) AS code
          WHERE btrim(code) <> ''
          ORDER BY code
        )
      ),
      true
    ),
    updated_at = now()
FROM eligible, admin_permissions
WHERE identity.id = eligible.id
  AND identity.tenant_id = eligible.tenant_id;

DO $$
BEGIN
  IF to_regclass('kernel.tenant_request') IS NULL THEN
    RAISE EXCEPTION 'v2_0068 could not create kernel.tenant_request';
  END IF;
  IF to_regclass('security.audit_event') IS NULL THEN
    RAISE EXCEPTION 'v2_0068 could not create security.audit_event';
  END IF;
END
$$;

COMMIT;
