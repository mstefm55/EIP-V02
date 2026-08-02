BEGIN;

ALTER TABLE tenant.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.tenant_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_settings_tenant_isolation
    ON tenant.tenant_settings;
DROP POLICY IF EXISTS tenant_settings_select_isolation
    ON tenant.tenant_settings;
DROP POLICY IF EXISTS tenant_settings_insert_isolation
    ON tenant.tenant_settings;
DROP POLICY IF EXISTS tenant_settings_update_isolation
    ON tenant.tenant_settings;
DROP POLICY IF EXISTS tenant_settings_delete_isolation
    ON tenant.tenant_settings;

CREATE POLICY tenant_settings_select_isolation
    ON tenant.tenant_settings
    FOR SELECT
    USING (tenant_id = security.current_tenant_id());

CREATE POLICY tenant_settings_insert_isolation
    ON tenant.tenant_settings
    FOR INSERT
    WITH CHECK (tenant_id = security.current_tenant_id());

CREATE POLICY tenant_settings_update_isolation
    ON tenant.tenant_settings
    FOR UPDATE
    USING (tenant_id = security.current_tenant_id())
    WITH CHECK (tenant_id = security.current_tenant_id());

CREATE POLICY tenant_settings_delete_isolation
    ON tenant.tenant_settings
    FOR DELETE
    USING (tenant_id = security.current_tenant_id());

COMMENT ON POLICY tenant_settings_select_isolation
    ON tenant.tenant_settings IS
  'Wave 2A fail-closed tenant read policy. Missing app.current_tenant_id resolves to null and exposes no rows.';
COMMENT ON POLICY tenant_settings_insert_isolation
    ON tenant.tenant_settings IS
  'Wave 2A fail-closed tenant insert policy. New rows must match the transaction-local app.current_tenant_id.';
COMMENT ON POLICY tenant_settings_update_isolation
    ON tenant.tenant_settings IS
  'Wave 2A fail-closed tenant update policy. Existing and updated rows must match the transaction-local app.current_tenant_id.';
COMMENT ON POLICY tenant_settings_delete_isolation
    ON tenant.tenant_settings IS
  'Wave 2A fail-closed tenant delete policy. Rows can only be deleted inside their transaction-local tenant context.';

COMMENT ON TABLE tenant.tenant_settings IS
  'Tenant-owned configuration rows. Wave 2A forces RLS; every normal runtime access must set app.current_tenant_id transaction-locally.';

COMMIT;
