BEGIN;

-- EIP Core V2 — canonical kernel info_record restoration.
--
-- This is a forward-only dependency repair inserted after v2_0049 and before
-- the not-yet-applicable v2_0050 Connection receipt migration. Applied
-- migrations remain immutable. `info_record` is an existing canonical kernel
-- concept used for governed information/evidence records; this migration restores
-- the physical V2 table that the kernel contract already expects.
--
-- Connections may use this generic object for bounded transport evidence, but
-- the table is not Connection-specific and carries no Process/workflow authority.

DO $$
BEGIN
  IF to_regclass('kernel.tenants') IS NULL THEN
    RAISE EXCEPTION 'info_record restoration requires kernel.tenants';
  END IF;
  IF to_regclass('eip_core.agent') IS NULL THEN
    RAISE EXCEPTION 'info_record restoration requires eip_core.agent';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS eip_core.info_record (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES kernel.tenants (tenant_id) ON DELETE RESTRICT,
    record_type text NOT NULL,
    title text,
    description text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_agent_id uuid REFERENCES eip_core.agent (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT info_record_type_not_blank_ck CHECK (btrim(record_type) <> ''),
    CONSTRAINT info_record_payload_object_ck CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT info_record_attrs_object_ck CHECK (jsonb_typeof(attrs) = 'object')
);

CREATE INDEX IF NOT EXISTS info_record_tenant_type_created_idx
  ON eip_core.info_record (tenant_id, record_type, created_at DESC);
CREATE INDEX IF NOT EXISTS info_record_created_by_agent_idx
  ON eip_core.info_record (created_by_agent_id);
CREATE INDEX IF NOT EXISTS info_record_payload_gin
  ON eip_core.info_record USING gin (payload);
CREATE INDEX IF NOT EXISTS info_record_attrs_gin
  ON eip_core.info_record USING gin (attrs);

ALTER TABLE eip_core.info_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE eip_core.info_record FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS info_record_tenant_isolation ON eip_core.info_record;
CREATE POLICY info_record_tenant_isolation
  ON eip_core.info_record
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());

COMMENT ON TABLE eip_core.info_record IS
  'Canonical tenant-scoped kernel information/evidence record. Generic payload/attrs metadata only; Process and business execution authority remain in the Process Engine and kernel objects.';
COMMENT ON COLUMN eip_core.info_record.record_type IS
  'Governed semantic record classification used by kernel/API consumers.';
COMMENT ON COLUMN eip_core.info_record.payload IS
  'Bounded governed information/evidence payload; credentials and raw secret material must not be stored.';

DO $$
BEGIN
  IF to_regclass('eip_core.info_record') IS NULL THEN
    RAISE EXCEPTION 'canonical eip_core.info_record restoration failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    WHERE c.oid = 'eip_core.info_record'::regclass
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = true
  ) THEN
    RAISE EXCEPTION 'eip_core.info_record must enforce tenant RLS';
  END IF;
END
$$;

COMMIT;
