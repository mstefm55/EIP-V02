BEGIN;

-- Owner Admin V1 -> V2 migration, Wave A.
--
-- Reuses the stable V1 dashboard information hierarchy (compact metrics +
-- operational work + recent activity) while retaining V2 data authority,
-- generic UI primitives, tenant scope, and truthful live DTOs.
--
-- No V1 mock KPI/transaction rows are copied and no new table is introduced.

DO $$
BEGIN
  IF to_regclass('eip_core.ui_surface') IS NULL THEN
    RAISE EXCEPTION 'v2_0064 requires eip_core.ui_surface';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.ui_surface
    WHERE tenant_id IS NULL
      AND version = 1
      AND code = 'owner_dashboard'
  ) THEN
    RAISE EXCEPTION 'v2_0064 requires owner_dashboard surface';
  END IF;
END
$$;

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {
    "module": "owner_admin",
    "surface_kind": "dashboard",
    "composition": "owner_admin_dashboard_v2"
  },
  "children": [
    {
      "id": "owner_dashboard_header",
      "type": "PanelHeader",
      "props": {
        "eyebrow": "Admin Console",
        "title": "Dashboard",
        "subtitle": "Current operational posture, work in progress, and recent activity for this organisation."
      }
    },
    {
      "id": "owner_dashboard_metrics",
      "type": "ContractMetricGrid",
      "props": {
        "eyebrow": "Current posture",
        "title": "Organisation overview",
        "data_contract": {
          "method": "GET",
          "endpoint": "/api/eip/owner-admin/overview"
        },
        "metrics_path": "metrics",
        "metrics": [
          {
            "key": "service_objects",
            "label": "Service Objects",
            "format": "number",
            "description": "Managed business work"
          },
          {
            "key": "open_tasks",
            "label": "Open Tasks",
            "format": "number",
            "description": "Current work requiring completion"
          },
          {
            "key": "active_process_instances",
            "label": "Active Processes",
            "format": "number",
            "description": "Processes currently running"
          },
          {
            "key": "active_process_definitions",
            "label": "Process Definitions",
            "format": "number",
            "description": "Active business process definitions"
          },
          {
            "key": "active_identities",
            "label": "Active Users",
            "format": "number",
            "description": "Active login identities"
          },
          {
            "key": "active_sessions",
            "label": "Active Sessions",
            "format": "number",
            "description": "Current authenticated sessions"
          }
        ]
      }
    },
    {
      "id": "owner_dashboard_operational_split",
      "type": "SplitLayout",
      "props": {
        "columns": 2,
        "min_column_width": "360px"
      },
      "children": [
        {
          "id": "owner_dashboard_tasks",
          "type": "ContractTablePanel",
          "props": {
            "eyebrow": "Work",
            "title": "Tasks requiring attention",
            "list_contract": {
              "method": "GET",
              "endpoint": "/api/eip/owner-admin/tasks?limit=12"
            },
            "row_id_key": "id",
            "empty_message": "No tasks are currently available.",
            "pagination": {
              "enabled": false
            },
            "columns": [
              {
                "key": "code",
                "label": "Object",
                "format": "text"
              },
              {
                "key": "title",
                "label": "Task",
                "format": "text"
              },
              {
                "key": "status",
                "label": "Status",
                "format": "text"
              },
              {
                "key": "due_at",
                "label": "Due",
                "format": "datetime"
              }
            ]
          }
        },
        {
          "id": "owner_dashboard_activity",
          "type": "ContractTablePanel",
          "props": {
            "eyebrow": "Activity",
            "title": "Recent activity",
            "list_contract": {
              "method": "GET",
              "endpoint": "/api/eip/owner-admin/activity?limit=12"
            },
            "row_id_key": "id",
            "empty_message": "No recent lifecycle activity is available.",
            "pagination": {
              "enabled": false
            },
            "columns": [
              {
                "key": "event_kind",
                "label": "Kind",
                "format": "text"
              },
              {
                "key": "subject_code",
                "label": "Object",
                "format": "text"
              },
              {
                "key": "subject_title",
                "label": "Activity",
                "format": "text"
              },
              {
                "key": "to_status",
                "label": "Status",
                "format": "text"
              },
              {
                "key": "occurred_at",
                "label": "Occurred",
                "format": "datetime"
              }
            ]
          }
        }
      ]
    }
  ]
}
$json$::jsonb,
    attrs = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(attrs, '{}'::jsonb),
          '{source}',
          '"v2_0064"'::jsonb,
          true
        ),
        '{surface_kind}',
        '"dashboard"'::jsonb,
        true
      ),
      '{surface_nav,hint}',
      to_jsonb('Operational posture, current work and recent activity'::text),
      true
    ),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_dashboard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.ui_surface
    WHERE tenant_id IS NULL
      AND version = 1
      AND code = 'owner_dashboard'
      AND tree #>> '{props,composition}' = 'owner_admin_dashboard_v2'
      AND attrs ->> 'source' = 'v2_0064'
      AND tree::text LIKE '%/api/eip/owner-admin/overview%'
      AND tree::text LIKE '%/api/eip/owner-admin/tasks?limit=12%'
      AND tree::text LIKE '%/api/eip/owner-admin/activity?limit=12%'
  ) THEN
    RAISE EXCEPTION 'v2_0064 could not install the upgraded owner dashboard';
  END IF;
END
$$;

COMMIT;
