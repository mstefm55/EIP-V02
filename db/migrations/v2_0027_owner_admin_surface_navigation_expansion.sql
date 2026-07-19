BEGIN;

UPDATE eip_core.ui_surface
SET attrs = COALESCE(attrs, '{}'::jsonb)
  || jsonb_build_object(
    'surface_nav',
    jsonb_build_object(
      'label', 'Process Builder',
      'order', 30,
      'default', true,
      'asset_key', 'surface.process',
      'icon', 'GitBranch'
    ),
    'source', 'v2_0027'
  ),
  updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'core_process_workbench';

UPDATE eip_core.ui_surface
SET attrs = COALESCE(attrs, '{}'::jsonb)
  || jsonb_build_object(
    'surface_nav',
    jsonb_build_object(
      'label', 'Ecom Process Profile',
      'order', 31,
      'default', false,
      'asset_key', 'surface.ecom',
      'icon', 'GitBranch'
    ),
    'source', 'v2_0027'
  ),
  updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'ecom_process_workbench';

UPDATE eip_core.ui_surface
SET attrs = COALESCE(attrs, '{}'::jsonb)
  || jsonb_build_object(
    'surface_nav',
    jsonb_build_object(
      'label', 'Ecom Review Console',
      'order', 150,
      'default', false,
      'asset_key', 'surface.ecom.review',
      'icon', 'ClipboardList'
    ),
    'source', 'v2_0027'
  ),
  updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'ecom_review_console';

WITH module_seed AS (
  SELECT * FROM (
    VALUES
      ('owner_dashboard', 'Dashboard', 10, 'LayoutGrid', 'dashboard', 'Dashboard', 'Platform-wide visibility for tenant operations and runtime posture.'),
      ('owner_tenant_requests', 'Tenant Requests', 20, 'ClipboardList', 'tenant_requests', 'Tenant Onboarding', 'Review and process tenant access onboarding queues.'),
      ('owner_connections', 'Connections', 40, 'Plug', 'connections', 'Connections', 'Track inbound and outbound integration endpoints.'),
      ('owner_tasks_follow_up', 'Tasks & Follow-up', 50, 'Activity', 'tasks_follow_up', 'Tasks & Follow-up', 'Coordinate owner-admin follow-up actions and escalations.'),
      ('owner_users_roles', 'Users & Roles', 60, 'Users', 'users_roles', 'Users & Roles', 'Manage access assignments and privileged identities.'),
      ('owner_portfolios', 'Portfolios', 70, 'Briefcase', 'portfolios', 'Portfolios', 'Review grouped capability bundles and delivery priorities.'),
      ('owner_templates', 'Templates', 80, 'Copy', 'templates', 'Templates', 'Maintain reusable templates used across tenant rollouts.'),
      ('owner_security', 'Security', 90, 'Shield', 'security', 'Security', 'Track security posture controls and pending hardening actions.'),
      ('owner_audit', 'Audit', 100, 'FileClock', 'audit', 'Audit', 'Inspect key operational audit events and compliance records.'),
      ('owner_data_explorer', 'Data Explorer', 110, 'Database', 'data_explorer', 'Data Explorer', 'Browse governed data checkpoints and evidence snapshots.'),
      ('owner_integrations', 'Integrations', 120, 'Plug', 'integrations', 'Integrations', 'Monitor integration health and connector readiness.'),
      ('owner_reports', 'Reports', 130, 'BarChart3', 'reports', 'Reports', 'Review owner-admin reporting packs and KPI summaries.'),
      ('owner_settings', 'Settings', 140, 'Settings', 'settings', 'Settings', 'Configure owner-admin shell preferences and platform defaults.')
  ) AS t(code, title, nav_order, nav_icon, surface_kind, eyebrow, subtitle)
),
module_seed_with_data AS (
  SELECT
    seed.*,
    CASE seed.code
      WHEN 'owner_dashboard' THEN jsonb_build_array(
        jsonb_build_object('item', 'Active tenants', 'status', 'Healthy', 'owner', 'Platform', 'updated_at', 'Updated 2 min ago'),
        jsonb_build_object('item', 'Pending onboarding', 'status', '7 in review', 'owner', 'Owner Admin', 'updated_at', 'Updated 5 min ago'),
        jsonb_build_object('item', 'Runtime incidents', 'status', 'No active critical alerts', 'owner', 'Security', 'updated_at', 'Updated 1 min ago')
      )
      WHEN 'owner_tenant_requests' THEN jsonb_build_array(
        jsonb_build_object('item', 'ARCADIA RETAIL LTD', 'status', 'Pending due diligence', 'owner', 'Onboarding Team', 'updated_at', 'Submitted today'),
        jsonb_build_object('item', 'NOVA LOGISTICS', 'status', 'Waiting for legal documents', 'owner', 'Compliance', 'updated_at', 'Submitted yesterday'),
        jsonb_build_object('item', 'BETA FOODS', 'status', 'Ready for activation', 'owner', 'Owner Admin', 'updated_at', 'Submitted today')
      )
      WHEN 'owner_connections' THEN jsonb_build_array(
        jsonb_build_object('item', 'SMTP Gateway', 'status', 'Operational', 'owner', 'Security', 'updated_at', 'Heartbeat 30s'),
        jsonb_build_object('item', 'ERP Partner API', 'status', 'Degraded latency', 'owner', 'Integrations', 'updated_at', 'Checked 4 min ago'),
        jsonb_build_object('item', 'SFTP Dropzone', 'status', 'Operational', 'owner', 'Integrations', 'updated_at', 'Heartbeat 1 min ago')
      )
      WHEN 'owner_tasks_follow_up' THEN jsonb_build_array(
        jsonb_build_object('item', 'Access review exceptions', 'status', '3 overdue', 'owner', 'Security', 'updated_at', 'Updated 8 min ago'),
        jsonb_build_object('item', 'Tenant onboarding follow-up', 'status', '5 due today', 'owner', 'Onboarding Team', 'updated_at', 'Updated 12 min ago'),
        jsonb_build_object('item', 'Policy publication reminders', 'status', 'On track', 'owner', 'Governance', 'updated_at', 'Updated 2 min ago')
      )
      WHEN 'owner_users_roles' THEN jsonb_build_array(
        jsonb_build_object('item', 'Privileged owner-admin accounts', 'status', '14 active', 'owner', 'Security', 'updated_at', 'Synced 3 min ago'),
        jsonb_build_object('item', 'Role-mapping reviews', 'status', '2 pending approvals', 'owner', 'Owner Admin', 'updated_at', 'Updated 11 min ago'),
        jsonb_build_object('item', 'Dormant users', 'status', '6 flagged', 'owner', 'Access Control', 'updated_at', 'Updated 5 min ago')
      )
      WHEN 'owner_portfolios' THEN jsonb_build_array(
        jsonb_build_object('item', 'Core Platform Portfolio', 'status', 'In delivery', 'owner', 'Platform PMO', 'updated_at', 'Updated today'),
        jsonb_build_object('item', 'Tenant Onboarding Portfolio', 'status', 'In review', 'owner', 'Onboarding PMO', 'updated_at', 'Updated today'),
        jsonb_build_object('item', 'Security Hardening Portfolio', 'status', 'In execution', 'owner', 'Security PMO', 'updated_at', 'Updated today')
      )
      WHEN 'owner_templates' THEN jsonb_build_array(
        jsonb_build_object('item', 'Owner Admin Shell Template', 'status', 'Published', 'owner', 'Platform', 'updated_at', 'Version 3'),
        jsonb_build_object('item', 'Tenant Request Intake Template', 'status', 'Draft', 'owner', 'Onboarding Team', 'updated_at', 'Version 2'),
        jsonb_build_object('item', 'Process Starter Template', 'status', 'Published', 'owner', 'Process Team', 'updated_at', 'Version 5')
      )
      WHEN 'owner_security' THEN jsonb_build_array(
        jsonb_build_object('item', 'Session inactivity enforcement', 'status', 'Enabled', 'owner', 'Security', 'updated_at', 'Checked now'),
        jsonb_build_object('item', 'CSRF protection controls', 'status', 'Enabled', 'owner', 'Security', 'updated_at', 'Checked now'),
        jsonb_build_object('item', 'Step-up verification coverage', 'status', 'Review scheduled', 'owner', 'Security', 'updated_at', 'Checked 7 min ago')
      )
      WHEN 'owner_audit' THEN jsonb_build_array(
        jsonb_build_object('item', 'Profile publish events', 'status', 'Available', 'owner', 'Audit', 'updated_at', 'Last 24h'),
        jsonb_build_object('item', 'Tenant override changes', 'status', 'Available', 'owner', 'Audit', 'updated_at', 'Last 24h'),
        jsonb_build_object('item', 'Auth step-up events', 'status', 'Available', 'owner', 'Audit', 'updated_at', 'Last 24h')
      )
      WHEN 'owner_data_explorer' THEN jsonb_build_array(
        jsonb_build_object('item', 'Tenant scope snapshots', 'status', 'Available', 'owner', 'Data Governance', 'updated_at', 'Updated 6 min ago'),
        jsonb_build_object('item', 'Process definition snapshots', 'status', 'Available', 'owner', 'Process Team', 'updated_at', 'Updated 4 min ago'),
        jsonb_build_object('item', 'Auth identity snapshots', 'status', 'Restricted', 'owner', 'Security', 'updated_at', 'Updated 2 min ago')
      )
      WHEN 'owner_integrations' THEN jsonb_build_array(
        jsonb_build_object('item', 'Email delivery integration', 'status', 'Operational', 'owner', 'Integrations', 'updated_at', 'Latency 420 ms'),
        jsonb_build_object('item', 'ERP outbound connector', 'status', 'Queued', 'owner', 'Integrations', 'updated_at', 'Checked 9 min ago'),
        jsonb_build_object('item', 'Webhook relay', 'status', 'Operational', 'owner', 'Integrations', 'updated_at', 'Latency 130 ms')
      )
      WHEN 'owner_reports' THEN jsonb_build_array(
        jsonb_build_object('item', 'Daily operations report', 'status', 'Generated', 'owner', 'Owner Admin', 'updated_at', 'Today 06:00'),
        jsonb_build_object('item', 'Security posture report', 'status', 'Generated', 'owner', 'Security', 'updated_at', 'Today 06:00'),
        jsonb_build_object('item', 'Tenant onboarding report', 'status', 'In progress', 'owner', 'Onboarding Team', 'updated_at', 'Running now')
      )
      WHEN 'owner_settings' THEN jsonb_build_array(
        jsonb_build_object('item', 'Shell profile selection', 'status', 'Governed', 'owner', 'Owner Admin', 'updated_at', 'Updated 3 min ago'),
        jsonb_build_object('item', 'Theme override policy', 'status', 'Governed', 'owner', 'Owner Admin', 'updated_at', 'Updated 3 min ago'),
        jsonb_build_object('item', 'Session guardrails', 'status', 'Governed', 'owner', 'Security', 'updated_at', 'Updated now')
      )
      ELSE jsonb_build_array()
    END AS records
  FROM module_seed AS seed
)
INSERT INTO eip_core.ui_surface
  (tenant_id, code, title, version, is_active, is_published, is_public, tree, attrs)
SELECT
  NULL,
  seed.code,
  seed.title,
  1,
  true,
  true,
  false,
  jsonb_build_object(
    'type', 'SurfaceRoot',
    'props', jsonb_build_object(
      'module', 'owner_admin',
      'surface_kind', seed.surface_kind,
      'records', seed.records
    ),
    'children', jsonb_build_array(
      jsonb_build_object(
        'id', seed.code || '_header',
        'type', 'PanelHeader',
        'props', jsonb_build_object(
          'eyebrow', seed.eyebrow,
          'title', seed.title,
          'subtitle', seed.subtitle
        )
      ),
      jsonb_build_object(
        'id', seed.code || '_records',
        'type', 'ContractTablePanel',
        'props', jsonb_build_object(
          'title', seed.title || ' Workspace',
          'eyebrow', 'Operational View',
          'preloaded_items_path', 'surfaceProps.records',
          'refresh_label', 'Refresh',
          'refreshing_label', 'Refreshing...',
          'empty_message', 'No records available for this workspace.',
          'table_max_height', '460px',
          'pagination', jsonb_build_object(
            'enabled', true,
            'default_page_size', 10,
            'page_size_options', jsonb_build_array(10, 25, 50)
          ),
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'item', 'label', 'Item', 'format', 'text'),
            jsonb_build_object('key', 'status', 'label', 'Status', 'format', 'text'),
            jsonb_build_object('key', 'owner', 'label', 'Owner', 'format', 'text'),
            jsonb_build_object('key', 'updated_at', 'label', 'Updated', 'format', 'text')
          )
        )
      )
    )
  ),
  jsonb_build_object(
    'module', 'owner_admin',
    'surface_kind', seed.surface_kind,
    'renderer_contract', 'metadata_tree_v1',
    'source', 'v2_0027',
    'surface_nav', jsonb_build_object(
      'label', seed.title,
      'order', seed.nav_order,
      'default', false,
      'asset_key', 'surface.process',
      'icon', seed.nav_icon
    )
  )
FROM module_seed_with_data AS seed
ON CONFLICT (tenant_id, code, version) DO UPDATE
SET title = EXCLUDED.title,
    is_active = EXCLUDED.is_active,
    is_published = EXCLUDED.is_published,
    is_public = EXCLUDED.is_public,
    tree = EXCLUDED.tree,
    attrs = EXCLUDED.attrs,
    updated_at = now();

COMMIT;
