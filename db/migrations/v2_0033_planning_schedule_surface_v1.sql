BEGIN;

INSERT INTO eip_core.ui_surface
  (tenant_id, code, title, version, is_active, is_published, is_public, tree, attrs)
VALUES
  (
    NULL,
    'planning_schedule',
    'Planning Schedule',
    1,
    true,
    true,
    false,
    $json$
    {
      "type": "SurfaceRoot",
      "props": {
        "module": "planning",
        "surface_kind": "planning_schedule",
        "renderer_contract": "metadata_tree_v1"
      },
      "children": [
        {
          "id": "planning_schedule_header",
          "type": "PanelHeader",
          "props": {
            "eyebrow": "Planning & Scheduling",
            "title": "Planning Schedule",
            "subtitle": "Persisted route schedules produced by governed Planning/Scheduling processes. This surface observes accepted dates; it does not calculate them."
          }
        },
        {
          "id": "planning_schedule_table",
          "type": "ContractTablePanel",
          "props": {
            "title": "Scheduled Route Steps",
            "eyebrow": "Operational Schedule",
            "list_contract": {
              "endpoint": "/api/eip/planning/schedule",
              "method": "GET",
              "query": {
                "limit": 100
              }
            },
            "row_id_key": "id",
            "refresh_label": "Refresh",
            "refreshing_label": "Refreshing...",
            "loading_title": "Loading accepted schedule...",
            "empty_message": "No persisted route schedules are available yet.",
            "error_title": "Unable to load schedule",
            "table_max_height": "620px",
            "pagination": {
              "enabled": true,
              "default_page_size": 25,
              "page_size_options": [10, 25, 50, 100]
            },
            "columns": [
              { "key": "service_object_code", "label": "Object", "format": "text" },
              { "key": "service_object_title", "label": "Title", "format": "text" },
              { "key": "object_type", "label": "Type", "format": "text" },
              { "key": "step_code", "label": "Route Step", "format": "text" },
              { "key": "process_code", "label": "Process", "format": "text" },
              { "key": "route_state", "label": "State", "format": "text" },
              { "key": "planned_start_at", "label": "Planned Start", "format": "datetime" },
              { "key": "planned_finish_at", "label": "Planned Finish", "format": "datetime" },
              { "key": "actual_completed_at", "label": "Actual Completion", "format": "datetime" },
              { "key": "wait_reason", "label": "Maturity / Wait", "format": "text" },
              { "key": "schedule_revision", "label": "Revision", "format": "text" }
            ]
          }
        }
      ]
    }
    $json$::jsonb,
    $json$
    {
      "module": "planning",
      "surface_kind": "planning_schedule",
      "renderer_contract": "metadata_tree_v1",
      "source": "v2_0033",
      "surface_nav": {
        "label": "Planning Schedule",
        "order": 35,
        "default": false,
        "asset_key": "surface.planning.schedule",
        "icon": "CalendarClock"
      }
    }
    $json$::jsonb
  )
ON CONFLICT (tenant_id, code, version) DO UPDATE
SET title = EXCLUDED.title,
    is_active = EXCLUDED.is_active,
    is_published = EXCLUDED.is_published,
    is_public = EXCLUDED.is_public,
    tree = EXCLUDED.tree,
    attrs = EXCLUDED.attrs,
    updated_at = now();

COMMIT;
