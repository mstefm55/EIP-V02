BEGIN;

-- EIP Core V2 — cluster-safe inbound Connection rate-limit runtime state.
--
-- This table exists only for bounded security/runtime counters. Connection
-- configuration remains in tenant.tenant_settings and transport evidence remains
-- in eip_core.info_record. A relational row is required here because concurrent
-- API workers must atomically increment the same tenant/connection/window bucket.

CREATE TABLE IF NOT EXISTS tenant.connection_inbound_rate_bucket (
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE CASCADE,
    connection_code text NOT NULL,
    bucket_started_at timestamptz NOT NULL,
    window_sec integer NOT NULL,
    request_count integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT connection_inbound_rate_bucket_pk
      PRIMARY KEY (tenant_id, connection_code, bucket_started_at),
    CONSTRAINT connection_inbound_rate_bucket_code_ck
      CHECK (char_length(btrim(connection_code)) BETWEEN 3 AND 64),
    CONSTRAINT connection_inbound_rate_bucket_window_ck
      CHECK (window_sec BETWEEN 1 AND 86400),
    CONSTRAINT connection_inbound_rate_bucket_count_ck
      CHECK (request_count > 0)
);

CREATE INDEX IF NOT EXISTS connection_inbound_rate_bucket_cleanup_idx
  ON tenant.connection_inbound_rate_bucket
    (tenant_id, connection_code, bucket_started_at DESC);

ALTER TABLE tenant.connection_inbound_rate_bucket ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.connection_inbound_rate_bucket FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connection_inbound_rate_bucket_select_isolation
  ON tenant.connection_inbound_rate_bucket;
DROP POLICY IF EXISTS connection_inbound_rate_bucket_insert_isolation
  ON tenant.connection_inbound_rate_bucket;
DROP POLICY IF EXISTS connection_inbound_rate_bucket_update_isolation
  ON tenant.connection_inbound_rate_bucket;
DROP POLICY IF EXISTS connection_inbound_rate_bucket_delete_isolation
  ON tenant.connection_inbound_rate_bucket;

CREATE POLICY connection_inbound_rate_bucket_select_isolation
  ON tenant.connection_inbound_rate_bucket
  FOR SELECT
  USING (tenant_id = security.current_tenant_id());

CREATE POLICY connection_inbound_rate_bucket_insert_isolation
  ON tenant.connection_inbound_rate_bucket
  FOR INSERT
  WITH CHECK (tenant_id = security.current_tenant_id());

CREATE POLICY connection_inbound_rate_bucket_update_isolation
  ON tenant.connection_inbound_rate_bucket
  FOR UPDATE
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());

CREATE POLICY connection_inbound_rate_bucket_delete_isolation
  ON tenant.connection_inbound_rate_bucket
  FOR DELETE
  USING (tenant_id = security.current_tenant_id());

COMMENT ON TABLE tenant.connection_inbound_rate_bucket IS
  'Ephemeral tenant-scoped fixed-window counters for governed inbound Connection rate limits. FORCE RLS is enabled; no request payload, credential or business data is stored.';
COMMENT ON COLUMN tenant.connection_inbound_rate_bucket.connection_code IS
  'Stable connection profile code. This is routing/security runtime state, not Process or business-workflow authority.';
COMMENT ON COLUMN tenant.connection_inbound_rate_bucket.bucket_started_at IS
  'UTC fixed-window boundary calculated from PostgreSQL clock time by the inbound rate-limit service.';

COMMIT;
