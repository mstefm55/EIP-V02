BEGIN;

UPDATE eip_core.ui_surface
SET tree = $json$
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
      "id": "planning_schedule_split",
      "type": "SplitLayout",
      "props": {
        "columns": 2,
        "min_column_width": "360px",
        "gap": "0.65rem",
        "align_items": "start"
      },
      "children": [
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
            "selection": {
              "target": "schedule_step",
              "key": "id",
              "auto_select_first": true
            },
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
              { "key": "process_code", "label": "Process", "format": "text" },
              { "key": "step_code", "label": "Route Step", "format": "text" },
              { "key": "route_state", "label": "State", "format": "text" },
              { "key": "planned_start_at", "label": "Planned Start", "format": "datetime" },
              { "key": "planned_finish_at", "label": "Planned Finish", "format": "datetime" },
              { "key": "wait_reason", "label": "Maturity / Wait", "format": "text" },
              { "key": "schedule_revision", "label": "Revision", "format": "text" }
            ]
          }
        },
        {
          "id": "planning_schedule_detail",
          "type": "SelectionDetailPanel",
          "props": {
            "title": "Schedule Step Details",
            "eyebrow": "Selected Route Step",
            "selection_target": "schedule_step",
            "empty_message": "Select a route step to inspect its accepted schedule and execution state.",
            "fields": [
              { "path": "service_object_code", "label": "Service Object", "format": "text" },
              { "path": "service_object_title", "label": "Title", "format": "text" },
              { "path": "object_type", "label": "Object Type", "format": "text" },
              { "path": "service_object_status", "label": "Object Status", "format": "text" },
              { "path": "process_code", "label": "Process", "format": "text" },
              { "path": "process_version", "label": "Process Version", "format": "number" },
              { "path": "step_code", "label": "Route Step", "format": "text" },
              { "path": "sequence", "label": "Sequence", "format": "number" },
              { "path": "route_state", "label": "Route State", "format": "text" },
              { "path": "scheduled", "label": "Scheduled", "format": "bool" },
              { "path": "mature", "label": "Mature", "format": "bool" },
              { "path": "wait_reason", "label": "Maturity / Wait", "format": "text" },
              { "path": "planned_start_at", "label": "Planned Start", "format": "datetime" },
              { "path": "planned_finish_at", "label": "Planned Finish", "format": "datetime" },
              { "path": "actual_completed_at", "label": "Actual Completion", "format": "datetime" },
              { "path": "schedule_source_code", "label": "Schedule Source", "format": "text" },
              { "path": "schedule_revision", "label": "Schedule Revision", "format": "text" },
              { "path": "process_instance_id", "label": "Process Instance", "format": "text" }
            ]
          }
        }
      ]
    }
  ]
}
$json$::jsonb,
attrs = COALESCE(attrs, '{}'::jsonb)
  || jsonb_build_object(
    'source', 'v2_0034',
    'selection_contract', jsonb_build_object(
      'targets', jsonb_build_array('schedule_step'),
      'default_target', 'schedule_step'
    )
  ),
updated_at = now()
WHERE tenant_id IS NULL
  AND code = 'planning_schedule'
  AND version = 1;

COMMIT;
