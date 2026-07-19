BEGIN;

CREATE TABLE IF NOT EXISTS tenant.tenant_settings (
    tenant_setting_id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    setting_key text NOT NULL,
    setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
    setting_status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenant_settings_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES kernel.tenants (tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT tenant_settings_tenant_key_uk UNIQUE (tenant_id, setting_key),
    CONSTRAINT tenant_settings_status_ck CHECK (setting_status IN ('active', 'deprecated', 'disabled')),
    CONSTRAINT tenant_settings_key_not_blank CHECK (btrim(setting_key) <> ''),
    CONSTRAINT tenant_settings_value_object_ck CHECK (jsonb_typeof(setting_value) = 'object')
);

CREATE INDEX IF NOT EXISTS tenant_tenant_settings_tenant_status_idx
    ON tenant.tenant_settings (tenant_id, setting_status);

COMMENT ON TABLE tenant.tenant_settings IS
  'Tenant-owned configuration rows. tenant_id is mandatory, uniqueness is tenant-scoped, and the payload is governed JSONB.';
COMMENT ON COLUMN tenant.tenant_settings.setting_value IS
  'Controlled JSONB object for tenant-scoped configuration. Keep core keys relational; use JSONB only for governed payloads.';

ALTER TABLE tenant.tenant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_settings_tenant_isolation
    ON tenant.tenant_settings
    USING (tenant_id = security.current_tenant_id())
    WITH CHECK (tenant_id = security.current_tenant_id());

COMMIT;
