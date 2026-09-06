BEGIN;

-- Owner Admin parity recovery.
-- Applied migrations remain immutable; this forward migration replaces the
-- over-generic v2_0031 editor composition with distinct UI-engine surfaces.
-- Kernel/process/auth business state is not modified.

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "dashboard"},
  "children": [
    {
      "id": "owner_dashboard_header",
      "type": "PanelHeader",
      "props": {
        "eyebrow": "Owner Admin",
        "title": "Dashboard",
        "subtitle": "Operational posture for the authenticated organisation, derived from live kernel and auth state."
      }
    },
    {
      "id": "owner_dashboard_metrics",
      "type": "ContractMetricGrid",
      "props": {
        "eyebrow": "Live posture",
        "title": "Organisation overview",
        "data_contract": {"method": "GET", "endpoint": "/api/eip/owner-admin/overview"},
        "metrics_path": "metrics",
        "metrics": [
          {"key": "service_objects", "label": "Service Objects", "format": "number", "description": "Managed kernel work objects"},
          {"key": "open_tasks", "label": "Open Tasks", "format": "number", "description": "Tasks without completion time"},
          {"key": "active_process_definitions", "label": "Active Process Definitions", "format": "number"},
          {"key": "active_process_instances", "label": "Active Process Instances", "format": "number"},
          {"key": "active_identities", "label": "Active Identities", "format": "number"},
          {"key": "active_sessions", "label": "Active Sessions", "format": "number"}
        ]
      }
    },
    {
      "id": "owner_dashboard_activity",
      "type": "ContractTablePanel",
      "props": {
        "eyebrow": "Recent activity",
        "title": "Kernel lifecycle events",
        "list_contract": {"method": "GET", "endpoint": "/api/eip/owner-admin/activity?limit=20"},
        "row_id_key": "id",
        "empty_message": "No lifecycle events recorded yet.",
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
    }
  ]
}$json$::jsonb,
    attrs = jsonb_set(
      jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0035"'::jsonb, true),
      '{surface_kind}', '"dashboard"'::jsonb, true
    ),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_dashboard';

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "tenant_requests"},
  "children": [
    {
      "id": "owner_tenant_requests_header",
      "type": "PanelHeader",
      "props": {
        "eyebrow": "Owner Admin",
        "title": "Tenant Requests",
        "subtitle": "Onboarding intake requires a persisted pre-tenant workflow before approval actions can be restored safely."
      }
    },
    {
      "id": "owner_tenant_requests_status",
      "type": "NoticePanel",
      "props": {
        "eyebrow": "Recovery status",
        "title": "Tenant request workflow is not yet restored",
        "message": "V2 currently accepts public access requests and delivers them by email, but does not persist a governed admin review queue. The previous generic Service Object editor has been removed rather than presenting fictional requests.",
        "items": [
          "Public request submission remains available.",
          "Approve/reject controls are intentionally withheld until the pre-tenant persistence model is restored.",
          "No kernel, tenant or business-state table is being invented by this UI repair."
        ]
      }
    }
  ]
}$json$::jsonb,
    attrs = jsonb_set(
      jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0035"'::jsonb, true),
      '{surface_kind}', '"tenant_requests"'::jsonb, true
    ),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_tenant_requests';

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "connections"},
  "children": [
    {
      "id": "owner_connections_header",
      "type": "PanelHeader",
      "props": {
        "eyebrow": "Owner Admin",
        "title": "Connections",
        "subtitle": "Gateway and external connection governance."
      }
    },
    {
      "id": "owner_connections_status",
      "type": "NoticePanel",
      "props": {
        "eyebrow": "Recovery status",
        "title": "Connection management is not yet restored in V2",
        "message": "The old generic owner_admin.connections records were scaffolding, not real gateway connection profiles. They are no longer used as the console authority.",
        "items": [
          "Provider credentials remain server-side.",
          "A future V2 connection surface must bind to real governed gateway profiles and tests.",
          "No fake connection CRUD is exposed."
        ]
      }
    }
  ]
}$json$::jsonb,
    attrs = jsonb_set(
      jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0035"'::jsonb, true),
      '{surface_kind}', '"connections"'::jsonb, true
    ),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_connections';

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "tasks_follow_up"},
  "children": [
    {
      "id": "owner_tasks_header",
      "type": "PanelHeader",
      "props": {
        "eyebrow": "Owner Admin",
        "title": "Tasks & Follow-up",
        "subtitle": "Live task state from the kernel workflow model."
      }
    },
    {
      "id": "owner_tasks_table",
      "type": "ContractTablePanel",
      "props": {
        "eyebrow": "Workflow",
        "title": "Current tasks",
        "list_contract": {"method": "GET", "endpoint": "/api/eip/owner-admin/tasks?limit=100"},
        "row_id_key": "id",
        "empty_message": "No tasks are currently available.",
        "columns": [
          {"key": "code", "label": "Service Object", "format": "text"},
          {"key": "title", "label": "Task", "format": "text"},
          {"key": "task_type", "label": "Type", "format": "text"},
          {"key": "status", "label": "Status", "format": "text"},
          {"key": "due_at", "label": "Due", "format": "datetime"},
          {"key": "updated_at", "label": "Updated", "format": "datetime"}
        ]
      }
    }
  ]
}$json$::jsonb,
    attrs = jsonb_set(
      jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0035"'::jsonb, true),
      '{surface_kind}', '"tasks_follow_up"'::jsonb, true
    ),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_tasks_follow_up';

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "users_roles"},
  "children": [
    {
      "id": "owner_users_header",
      "type": "PanelHeader",
      "props": {
        "eyebrow": "Owner Admin",
        "title": "Users & Roles",
        "subtitle": "Identity visibility from the V2 authentication model."
      }
    },
    {
      "id": "owner_users_split",
      "type": "SplitLayout",
      "props": {"columns": 2, "min_column_width": "320px"},
      "children": [
        {
          "id": "owner_users_table",
          "type": "ContractTablePanel",
          "props": {
            "eyebrow": "Access",
            "title": "Identities",
            "list_contract": {"method": "GET", "endpoint": "/api/eip/owner-admin/users?limit=100"},
            "row_id_key": "id",
            "empty_message": "No identities are available.",
            "columns": [
              {"key": "login", "label": "Login", "format": "text"},
              {"key": "email", "label": "Email", "format": "text"},
              {"key": "login_type", "label": "Type", "format": "text"},
              {"key": "status", "label": "Status", "format": "text"},
              {"key": "permission_count", "label": "Permissions", "format": "number"},
              {"key": "updated_at", "label": "Updated", "format": "datetime"}
            ]
          }
        },
        {
          "id": "owner_users_role_status",
          "type": "NoticePanel",
          "props": {
            "eyebrow": "Role governance",
            "title": "Role assignment editing remains protected",
            "message": "V2 now shows real identities instead of fake owner_admin.users_roles records. Role and permission mutation controls will return only when the V2 authorization contract is fully restored.",
            "items": [
              "Identity state is live and tenant-scoped.",
              "No direct credential material is exposed.",
              "No generic Process Definition permission is used as a Users & Roles write authority."
            ]
          }
        }
      ]
    }
  ]
}$json$::jsonb,
    attrs = jsonb_set(
      jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0035"'::jsonb, true),
      '{surface_kind}', '"users_roles"'::jsonb, true
    ),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_users_roles';

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "portfolios"},
  "children": [
    {"id": "owner_portfolios_header", "type": "PanelHeader", "props": {"eyebrow": "Owner Admin", "title": "Portfolios", "subtitle": "Portfolio administration."}},
    {"id": "owner_portfolios_status", "type": "NoticePanel", "props": {"eyebrow": "Recovery status", "title": "Portfolio administration is not yet restored in V2", "message": "The generic portfolio Service Object editor has been removed because it did not represent the V1 portfolio assignment semantics."}}
  ]
}$json$::jsonb,
    attrs = jsonb_set(jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0035"'::jsonb, true), '{surface_kind}', '"portfolios"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_portfolios';

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "templates"},
  "children": [
    {"id": "owner_templates_header", "type": "PanelHeader", "props": {"eyebrow": "Owner Admin", "title": "Templates", "subtitle": "Governed tenant and operational templates."}},
    {"id": "owner_templates_status", "type": "NoticePanel", "props": {"eyebrow": "Recovery status", "title": "Template administration is not yet restored in V2", "message": "The previous generic template editor was scaffolding. Template clone/publish semantics must bind to a real governed template contract before write controls return."}}
  ]
}$json$::jsonb,
    attrs = jsonb_set(jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0035"'::jsonb, true), '{surface_kind}', '"templates"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_templates';

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "security"},
  "children": [
    {
      "id": "owner_security_header",
      "type": "PanelHeader",
      "props": {
        "eyebrow": "Owner Admin",
        "title": "Security",
        "subtitle": "Live authentication sessions and trusted-device posture."
      }
    },
    {
      "id": "owner_security_tabs",
      "type": "Tabs",
      "props": {
        "eyebrow": "Authentication",
        "title": "Security posture",
        "default_tab_id": "sessions",
        "tabs": [
          {"id": "sessions", "label": "Active Sessions", "child_id": "owner_security_sessions", "icon": "session"},
          {"id": "devices", "label": "Devices", "child_id": "owner_security_devices", "icon": "session"}
        ]
      },
      "children": [
        {
          "id": "owner_security_sessions",
          "type": "ContractTablePanel",
          "props": {
            "title": "Active sessions",
            "list_contract": {"method": "GET", "endpoint": "/api/eip/owner-admin/security/sessions?limit=100"},
            "row_id_key": "row_key",
            "empty_message": "No active sessions are available.",
            "columns": [
              {"key": "login", "label": "Login", "format": "text"},
              {"key": "device_trust", "label": "Device", "format": "text"},
              {"key": "assurance", "label": "Assurance", "format": "text"},
              {"key": "issued_at", "label": "Issued", "format": "datetime"},
              {"key": "last_seen_at", "label": "Last Seen", "format": "datetime"},
              {"key": "expires_at", "label": "Expires", "format": "datetime"}
            ]
          }
        },
        {
          "id": "owner_security_devices",
          "type": "ContractTablePanel",
          "props": {
            "title": "Browser devices",
            "list_contract": {"method": "GET", "endpoint": "/api/eip/owner-admin/security/devices?limit=100"},
            "row_id_key": "id",
            "empty_message": "No browser devices are registered.",
            "columns": [
              {"key": "login", "label": "Login", "format": "text"},
              {"key": "trust_state", "label": "Trust", "format": "text"},
              {"key": "first_seen_at", "label": "First Seen", "format": "datetime"},
              {"key": "last_seen_at", "label": "Last Seen", "format": "datetime"},
              {"key": "revoked_at", "label": "Revoked", "format": "datetime"}
            ]
          }
        }
      ]
    }
  ]
}$json$::jsonb,
    attrs = jsonb_set(jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0035"'::jsonb, true), '{surface_kind}', '"security"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_security';

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "audit"},
  "children": [
    {"id": "owner_audit_header", "type": "PanelHeader", "props": {"eyebrow": "Owner Admin", "title": "Audit", "subtitle": "Append-only kernel lifecycle evidence currently available in V2."}},
    {
      "id": "owner_audit_events",
      "type": "ContractTablePanel",
      "props": {
        "eyebrow": "Lifecycle evidence",
        "title": "Recent status events",
        "list_contract": {"method": "GET", "endpoint": "/api/eip/owner-admin/activity?limit=100"},
        "row_id_key": "id",
        "empty_message": "No lifecycle evidence is available yet.",
        "columns": [
          {"key": "event_kind", "label": "Kind", "format": "text"},
          {"key": "subject_code", "label": "Object", "format": "text"},
          {"key": "subject_title", "label": "Title", "format": "text"},
          {"key": "from_status", "label": "From", "format": "text"},
          {"key": "to_status", "label": "To", "format": "text"},
          {"key": "reason_code", "label": "Reason", "format": "text"},
          {"key": "occurred_at", "label": "Occurred", "format": "datetime"}
        ]
      }
    },
    {"id": "owner_audit_scope", "type": "NoticePanel", "props": {"eyebrow": "Scope", "title": "Security operations audit remains a separate recovery item", "message": "This surface shows real kernel lifecycle events only. It does not relabel them as a complete security/compliance audit stream."}}
  ]
}$json$::jsonb,
    attrs = jsonb_set(jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0035"'::jsonb, true), '{surface_kind}', '"audit"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_audit';

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "data_explorer"},
  "children": [
    {"id": "owner_data_header", "type": "PanelHeader", "props": {"eyebrow": "Owner Admin", "title": "Data Explorer", "subtitle": "Governed data inspection."}},
    {"id": "owner_data_status", "type": "NoticePanel", "props": {"eyebrow": "Recovery status", "title": "Data Explorer is not yet restored in V2", "message": "The previous generic dataset notes were not a real database explorer. Sensitive data browsing/export must return with explicit permission, DTO and redaction boundaries."}}
  ]
}$json$::jsonb,
    attrs = jsonb_set(jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0035"'::jsonb, true), '{surface_kind}', '"data_explorer"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_data_explorer';

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "integrations"},
  "children": [
    {"id": "owner_integrations_header", "type": "PanelHeader", "props": {"eyebrow": "Owner Admin", "title": "Integrations", "subtitle": "External provider and integration governance."}},
    {"id": "owner_integrations_status", "type": "NoticePanel", "props": {"eyebrow": "Recovery status", "title": "Integration administration is not yet restored in V2", "message": "The generic integration records have been removed from runtime authority. Real provider profiles must keep credentials server-side and use validated destinations."}}
  ]
}$json$::jsonb,
    attrs = jsonb_set(jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0035"'::jsonb, true), '{surface_kind}', '"integrations"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_integrations';

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "reports"},
  "children": [
    {"id": "owner_reports_header", "type": "PanelHeader", "props": {"eyebrow": "Owner Admin", "title": "Reports", "subtitle": "Governed reporting catalogue and execution history."}},
    {"id": "owner_reports_status", "type": "NoticePanel", "props": {"eyebrow": "Recovery status", "title": "Reporting administration is not yet restored in V2", "message": "The earlier daily-report Service Object was sample data, not a reporting engine. The console now states that boundary instead of presenting fake executions."}}
  ]
}$json$::jsonb,
    attrs = jsonb_set(jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0035"'::jsonb, true), '{surface_kind}', '"reports"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_reports';

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {"module": "owner_admin", "surface_kind": "settings"},
  "children": [
    {"id": "owner_settings_header", "type": "PanelHeader", "props": {"eyebrow": "Owner Admin", "title": "Settings", "subtitle": "Tenant-scoped governed configuration visibility."}},
    {
      "id": "owner_settings_split",
      "type": "SplitLayout",
      "props": {"columns": 2, "min_column_width": "320px"},
      "children": [
        {
          "id": "owner_settings_table",
          "type": "ContractTablePanel",
          "props": {
            "eyebrow": "Governed settings",
            "title": "Configuration keys",
            "list_contract": {"method": "GET", "endpoint": "/api/eip/owner-admin/settings"},
            "row_id_key": "id",
            "empty_message": "No tenant settings are currently defined.",
            "columns": [
              {"key": "setting_key", "label": "Setting", "format": "text"},
              {"key": "status", "label": "Status", "format": "text"},
              {"key": "updated_at", "label": "Updated", "format": "datetime"}
            ]
          }
        },
        {
          "id": "owner_settings_notice",
          "type": "NoticePanel",
          "props": {
            "eyebrow": "Safety boundary",
            "title": "Read-only configuration visibility",
            "message": "Settings values are intentionally not exposed by this first parity repair. Shell/profile editing remains governed by its dedicated lifecycle and tenant override model.",
            "items": [
              "No secret values are serialized to the browser.",
              "Shell profile lifecycle remains authoritative.",
              "Write controls will be added only through dedicated governed contracts."
            ]
          }
        }
      ]
    }
  ]
}$json$::jsonb,
    attrs = jsonb_set(jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0035"'::jsonb, true), '{surface_kind}', '"settings"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_settings';

COMMIT;
