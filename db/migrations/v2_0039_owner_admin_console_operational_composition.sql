BEGIN;

-- EIP Core V2 Owner/Admin Console operational composition correction.
-- Forward-only metadata repair following v2_0035.
-- No new table, no synthetic owner_admin.* business records, no UI business authority.
-- Live modules remain navigable; deferred capabilities remain visible but disabled
-- through governed surface_nav metadata until a real server contract exists.

WITH nav_state(code, enabled, hint) AS (
  VALUES
    ('owner_dashboard', true, 'Live platform posture and activity'),
    ('owner_tenant_requests', false, 'Unavailable until a governed persisted pre-tenant review queue exists'),
    ('owner_connections', false, 'Unavailable until governed gateway connection profiles are restored'),
    ('owner_tasks_follow_up', true, 'Live kernel tasks and follow-up state'),
    ('owner_users_roles', true, 'Live identities; role mutation remains protected'),
    ('owner_portfolios', false, 'Unavailable until a governed portfolio contract exists'),
    ('owner_templates', false, 'Unavailable until governed template lifecycle semantics exist'),
    ('owner_security', true, 'Live sessions and registered device posture'),
    ('owner_audit', true, 'Live kernel lifecycle evidence'),
    ('owner_data_explorer', false, 'Unavailable until explicit DTO, permission and redaction boundaries exist'),
    ('owner_integrations', false, 'Unavailable until governed provider/integration profiles exist'),
    ('owner_reports', true, 'Live operational snapshot; report-engine lifecycle remains separate'),
    ('owner_settings', true, 'Live governed tenant setting keys and state')
)
UPDATE eip_core.ui_surface AS surface
SET attrs = jsonb_set(
      jsonb_set(
        COALESCE(surface.attrs, '{}'::jsonb),
        '{surface_nav,enabled}',
        to_jsonb(nav_state.enabled),
        true
      ),
      '{surface_nav,hint}',
      to_jsonb(nav_state.hint),
      true
    )
    || jsonb_build_object('source', 'v2_0039'),
    updated_at = now()
FROM nav_state
WHERE surface.tenant_id IS NULL
  AND surface.version = 1
  AND surface.code = nav_state.code;

-- Reports is a truthful live operational snapshot using existing bounded Owner/Admin
-- DTOs. It does not claim a report catalogue/execution engine that V2 does not have.
UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "reports"},
  "children": [
    {
      "id": "owner_reports_header",
      "type": "PanelHeader",
      "props": {
        "eyebrow": "Owner Admin",
        "title": "Reports",
        "subtitle": "Live operational snapshot from governed kernel and authentication projections."
      }
    },
    {
      "id": "owner_reports_metrics",
      "type": "ContractMetricGrid",
      "props": {
        "eyebrow": "Current snapshot",
        "title": "Operational summary",
        "data_contract": {"method": "GET", "endpoint": "/api/eip/owner-admin/overview"},
        "metrics_path": "metrics",
        "metrics": [
          {"key": "service_objects", "label": "Service Objects", "format": "number"},
          {"key": "open_tasks", "label": "Open Tasks", "format": "number"},
          {"key": "active_process_instances", "label": "Active Processes", "format": "number"},
          {"key": "active_identities", "label": "Active Identities", "format": "number"},
          {"key": "active_sessions", "label": "Active Sessions", "format": "number"}
        ]
      }
    },
    {
      "id": "owner_reports_activity",
      "type": "ContractTablePanel",
      "props": {
        "eyebrow": "Evidence",
        "title": "Recent lifecycle activity",
        "list_contract": {"method": "GET", "endpoint": "/api/eip/owner-admin/activity?limit=50"},
        "row_id_key": "id",
        "empty_message": "No lifecycle events are currently available.",
        "pagination": {"enabled": false},
        "columns": [
          {"key": "event_kind", "label": "Kind", "format": "text"},
          {"key": "subject_code", "label": "Object", "format": "text"},
          {"key": "subject_title", "label": "Title", "format": "text"},
          {"key": "from_status", "label": "From", "format": "text"},
          {"key": "to_status", "label": "To", "format": "text"},
          {"key": "occurred_at", "label": "Occurred", "format": "datetime"}
        ]
      }
    },
    {
      "id": "owner_reports_boundary",
      "type": "NoticePanel",
      "props": {
        "eyebrow": "Boundary",
        "title": "Operational snapshot",
        "message": "This page is a live bounded operational view. Scheduled report definitions, execution history and exports remain unavailable until a governed reporting contract is implemented."
      }
    }
  ]
}$json$::jsonb,
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0039"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_reports';

-- Strengthen the dashboard explanation without changing the real data contracts.
UPDATE eip_core.ui_surface
SET attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0039"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code IN (
    'owner_dashboard',
    'owner_tasks_follow_up',
    'owner_users_roles',
    'owner_security',
    'owner_audit',
    'owner_settings'
  );

COMMIT;
