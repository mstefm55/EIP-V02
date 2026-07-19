BEGIN;

INSERT INTO eip_core.ui_surface
  (tenant_id, code, title, version, is_active, is_published, is_public, tree, attrs)
VALUES
  (
    NULL,
    'core_process_workbench',
    'Core Process Workbench',
    1,
    true,
    true,
    false,
    $json$
    {
      "type": "SurfaceRoot",
      "props": {
        "module": "process",
        "surface_kind": "process_workbench",
        "renderer_contract": "metadata_tree_v1",
        "workbench_contract": "process_workbench_v1",
        "default_module_filter": null
      },
      "children": [
        {
          "id": "workbench_header",
          "type": "PanelHeader",
          "props": {
            "title": "Process Builder Workbench",
            "subtitle": "UI-engine surface for process definitions, macros, effects, templates, and bindings."
          }
        },
        {
          "id": "workbench_catalog",
          "type": "ContractTablePanel",
          "props": {
            "title": "Process Catalog",
            "eyebrow": "Workbench Contract",
            "list_contract": {
              "endpoint": "/api/eip/process/workbench/catalog",
              "method": "GET",
              "query": {
                "module": "$surface.default_module_filter"
              }
            },
            "columns": [
              { "key": "code", "label": "Code" },
              { "key": "name", "label": "Name" },
              { "key": "module", "label": "Module" },
              { "key": "object_type", "label": "Object Type" },
              { "key": "service_object_category", "label": "Service Object Category" },
              { "key": "graph_summary", "label": "Graph Summary", "format": "graph_summary" },
              { "key": "workbench_counts", "label": "Workbench Counts", "format": "workbench_counts" }
            ],
            "row_id_key": "id",
            "selection": {
              "target": "definition",
              "key": "id",
              "auto_select_first": true,
              "clear_on_new": true,
              "new_action": {
                "label": "New Definition",
                "requires_any_permission": ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"]
              }
            }
          }
        },
        {
          "id": "definition_studio",
          "type": "ProcessDefinitionStudio",
          "props": {
            "title": "Definition Studio",
            "eyebrow": "Workbench Contract",
            "detail_source": {
              "endpoint": "/api/eip/process/workbench/defs/:id",
              "method": "GET"
            },
            "create_contract": {
              "endpoint": "/api/eip/process/defs",
              "method": "POST"
            },
            "save_contract": {
              "endpoint": "/api/eip/process/defs/:id",
              "method": "PATCH"
            },
            "validate_contract": {
              "endpoint": "/api/eip/process/defs/:id/validate",
              "method": "POST"
            },
            "publish_contract": {
              "endpoint": "/api/eip/process/defs/:id/publish",
              "method": "POST"
            },
            "taxonomy_contract": {
              "endpoint": "/api/eip/process/taxonomy",
              "method": "GET"
            }
          }
        },
        {
          "id": "task_template_editor",
          "type": "ContractRecordEditor",
          "props": {
            "title": "Task Template Workbench",
            "eyebrow": "Workbench Contract",
            "selection_required_path": "selection.definition.id",
            "selection_required_message": "Select a process definition to author task templates.",
            "permissions_any": ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"],
            "read_only_message": "Missing write permission for task-template authoring.",
            "list_contract": {
              "endpoint": "/api/eip/process/task-templates",
              "method": "GET",
              "query": {
                "process_def_id": "$selection.id"
              }
            },
            "create_contract": {
              "endpoint": "/api/eip/process/task-templates",
              "method": "POST"
            },
            "update_contract": {
              "endpoint": "/api/eip/process/task-templates/:id",
              "method": "PATCH"
            },
            "list_view": {
              "id_key": "id",
              "title_field": "task_type",
              "subtitle_field": "title",
              "empty_subtitle": "-",
              "empty_list_message": "No task templates found.",
              "empty_editor_message": "Choose a template or start a new one."
            },
            "fields": [
              { "key": "task_type", "label": "Task Type", "required": true },
              { "key": "service_object_type", "label": "Service Object Type" },
              { "key": "title", "label": "Title" },
              { "key": "description", "label": "Description", "type": "textarea", "rows": 3 },
              { "key": "sort_order", "label": "Sort Order", "type": "number", "default_value": 100 },
              { "key": "is_active", "label": "Is Active", "type": "checkbox", "default_value": true },
              { "key": "allowed_actions_text", "label": "Allowed Actions (CSV)" },
              { "key": "completion_action", "label": "Completion Action" },
              { "key": "attrs_text", "label": "Template Attrs (JSON)", "type": "json", "rows": 6, "default_value": "{}" }
            ],
            "item_mapping": [
              { "field": "task_type", "from": "task_type" },
              { "field": "service_object_type", "from": "service_object_type" },
              { "field": "title", "from": "title" },
              { "field": "description", "from": "description" },
              { "field": "sort_order", "from": "sort_order", "transform": "number", "default_value": 100 },
              { "field": "is_active", "from": "is_active", "transform": "bool", "default_value": true },
              { "field": "allowed_actions_text", "from": "attrs.allowed_actions", "transform": "array_csv" },
              { "field": "completion_action", "from": "attrs.completion_action" },
              { "field": "attrs_text", "from": "attrs", "transform": "json_pretty_or_default", "default_value": {} }
            ],
            "save_payload": {
              "template": {
                "process_def_id": "$selection.id",
                "service_object_type": "$draft.service_object_type",
                "task_type": "$draft.task_type",
                "title": "$draft.title",
                "description": "$draft.description",
                "sort_order": "$draft.sort_order",
                "is_active": "$draft.is_active"
              },
              "number_fields": ["sort_order"],
              "boolean_fields": ["is_active"],
              "omit_empty_fields": ["service_object_type", "title", "description"],
              "attrs": {
                "target": "attrs",
                "json_field": "attrs_text",
                "merges": [
                  {
                    "target": "allowed_actions",
                    "from": "$draft.allowed_actions_text",
                    "transform": "comma_list",
                    "omit_empty": true
                  },
                  {
                    "target": "completion_action",
                    "from": "$draft.completion_action",
                    "omit_empty": true
                  }
                ]
              }
            },
            "deactivate_payload": {
              "is_active": false
            },
            "actions": {
              "new_label": "New",
              "refresh_label": "Refresh",
              "save_label": "Save",
              "save_busy_label": "Saving...",
              "deactivate_label": "Deactivate"
            }
          }
        },
        {
          "id": "binding_editor",
          "type": "ContractRecordEditor",
          "props": {
            "title": "Process Binding Workbench",
            "eyebrow": "Workbench Contract",
            "selection_required_path": "selection.definition.id",
            "selection_required_message": "Select a process definition to author bindings.",
            "permissions_any": ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"],
            "read_only_message": "Missing write permission for binding authoring.",
            "list_contract": {
              "endpoint": "/api/eip/process/bindings",
              "method": "GET",
              "query": {
                "process_def_id": "$selection.id"
              }
            },
            "create_contract": {
              "endpoint": "/api/eip/process/bindings",
              "method": "POST"
            },
            "update_contract": {
              "endpoint": "/api/eip/process/bindings/:id",
              "method": "PATCH"
            },
            "list_view": {
              "id_key": "id",
              "title_field": "service_object_type",
              "subtitle_field": "task_type",
              "empty_subtitle": "All tasks",
              "empty_list_message": "No process bindings found.",
              "empty_editor_message": "Choose a binding or start a new one."
            },
            "fields": [
              { "key": "service_object_type", "label": "Service Object Type", "required": true },
              { "key": "task_type", "label": "Task Type" },
              { "key": "priority", "label": "Priority", "type": "number", "default_value": 100 },
              { "key": "is_active", "label": "Is Active", "type": "checkbox", "default_value": true },
              { "key": "attrs_text", "label": "Binding Attrs (JSON)", "type": "json", "rows": 6, "default_value": "{}" }
            ],
            "item_mapping": [
              { "field": "service_object_type", "from": "service_object_type" },
              { "field": "task_type", "from": "task_type" },
              { "field": "priority", "from": "priority", "transform": "number", "default_value": 100 },
              { "field": "is_active", "from": "is_active", "transform": "bool", "default_value": true },
              { "field": "attrs_text", "from": "attrs", "transform": "json_pretty_or_default", "default_value": {} }
            ],
            "save_payload": {
              "template": {
                "process_def_id": "$selection.id",
                "service_object_type": "$draft.service_object_type",
                "task_type": "$draft.task_type",
                "priority": "$draft.priority",
                "is_active": "$draft.is_active"
              },
              "number_fields": ["priority"],
              "boolean_fields": ["is_active"],
              "omit_empty_fields": ["task_type"],
              "attrs": {
                "target": "attrs",
                "json_field": "attrs_text"
              }
            },
            "deactivate_payload": {
              "is_active": false
            },
            "actions": {
              "new_label": "New",
              "refresh_label": "Refresh",
              "save_label": "Save",
              "save_busy_label": "Saving...",
              "deactivate_label": "Deactivate"
            }
          }
        },
        {
          "id": "instance_stream",
          "type": "ContractTablePanel",
          "props": {
            "title": "Process Instance Stream",
            "eyebrow": "Workbench Contract",
            "list_contract": {
              "endpoint": "/api/eip/process/instances",
              "method": "GET"
            },
            "preloaded_items_path": "selection.detail.recent_instances",
            "columns": [
              { "key": "id", "label": "Instance Id" },
              { "key": "status", "label": "Status" },
              { "key": "service_object_id", "label": "Service Object" },
              { "key": "started_at", "label": "Started", "format": "datetime" },
              { "key": "updated_at", "label": "Updated", "format": "datetime" }
            ],
            "row_id_key": "id",
            "loading_title": "Loading process instances...",
            "empty_message": "No process instances found."
          }
        }
      ]
    }
    $json$::jsonb,
    '{"module":"process","surface_kind":"process_workbench","renderer_contract":"metadata_tree_v1","workbench_contract":"process_workbench_v1","realm":"EIP","surface_nav":{"label":"Core Workbench","order":10,"default":true,"asset_key":"surface.process"},"ui_composition_model":"generic_primitives_v1","source":"v2_0014"}'::jsonb
  ),
  (
    NULL,
    'ecom_process_workbench',
    'Ecom Process Workbench',
    1,
    true,
    true,
    false,
    $json$
    {
      "type": "SurfaceRoot",
      "props": {
        "module": "ecom",
        "surface_kind": "process_workbench",
        "renderer_contract": "metadata_tree_v1",
        "workbench_contract": "process_workbench_v1",
        "default_module_filter": "ecom"
      },
      "children": [
        {
          "id": "workbench_header",
          "type": "PanelHeader",
          "props": {
            "title": "Ecom Process Workbench",
            "subtitle": "Inspect and operate seeded ecom process definitions through governed process engine contracts."
          }
        },
        {
          "id": "workbench_catalog",
          "type": "ContractTablePanel",
          "props": {
            "title": "Process Catalog",
            "eyebrow": "Workbench Contract",
            "list_contract": {
              "endpoint": "/api/eip/process/workbench/catalog",
              "method": "GET",
              "query": {
                "module": "ecom"
              }
            },
            "columns": [
              { "key": "code", "label": "Code" },
              { "key": "name", "label": "Name" },
              { "key": "object_type", "label": "Object Type" },
              { "key": "service_object_category", "label": "Service Object Category" },
              { "key": "graph_summary", "label": "Graph Summary", "format": "graph_summary" },
              { "key": "workbench_counts", "label": "Workbench Counts", "format": "workbench_counts" }
            ],
            "row_id_key": "id",
            "selection": {
              "target": "definition",
              "key": "id",
              "auto_select_first": true,
              "clear_on_new": true,
              "new_action": {
                "label": "New Definition",
                "requires_any_permission": ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"]
              }
            }
          }
        },
        {
          "id": "definition_studio",
          "type": "ProcessDefinitionStudio",
          "props": {
            "title": "Definition Studio",
            "eyebrow": "Workbench Contract",
            "detail_source": {
              "endpoint": "/api/eip/process/workbench/defs/:id",
              "method": "GET"
            },
            "save_contract": {
              "endpoint": "/api/eip/process/defs/:id",
              "method": "PATCH"
            },
            "validate_contract": {
              "endpoint": "/api/eip/process/defs/:id/validate",
              "method": "POST"
            },
            "publish_contract": {
              "endpoint": "/api/eip/process/defs/:id/publish",
              "method": "POST"
            },
            "taxonomy_contract": {
              "endpoint": "/api/eip/process/taxonomy",
              "method": "GET"
            }
          }
        },
        {
          "id": "task_template_editor",
          "type": "ContractRecordEditor",
          "props": {
            "title": "Task Template Workbench",
            "eyebrow": "Workbench Contract",
            "selection_required_path": "selection.definition.id",
            "selection_required_message": "Select a process definition to author task templates.",
            "permissions_any": ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"],
            "read_only_message": "Missing write permission for task-template authoring.",
            "list_contract": {
              "endpoint": "/api/eip/process/task-templates",
              "method": "GET",
              "query": {
                "process_def_id": "$selection.id"
              }
            },
            "create_contract": {
              "endpoint": "/api/eip/process/task-templates",
              "method": "POST"
            },
            "update_contract": {
              "endpoint": "/api/eip/process/task-templates/:id",
              "method": "PATCH"
            },
            "list_view": {
              "id_key": "id",
              "title_field": "task_type",
              "subtitle_field": "title",
              "empty_subtitle": "-",
              "empty_list_message": "No task templates found.",
              "empty_editor_message": "Choose a template or start a new one."
            },
            "fields": [
              { "key": "task_type", "label": "Task Type", "required": true },
              { "key": "service_object_type", "label": "Service Object Type" },
              { "key": "title", "label": "Title" },
              { "key": "description", "label": "Description", "type": "textarea", "rows": 3 },
              { "key": "sort_order", "label": "Sort Order", "type": "number", "default_value": 100 },
              { "key": "is_active", "label": "Is Active", "type": "checkbox", "default_value": true },
              { "key": "allowed_actions_text", "label": "Allowed Actions (CSV)" },
              { "key": "completion_action", "label": "Completion Action" },
              { "key": "attrs_text", "label": "Template Attrs (JSON)", "type": "json", "rows": 6, "default_value": "{}" }
            ],
            "item_mapping": [
              { "field": "task_type", "from": "task_type" },
              { "field": "service_object_type", "from": "service_object_type" },
              { "field": "title", "from": "title" },
              { "field": "description", "from": "description" },
              { "field": "sort_order", "from": "sort_order", "transform": "number", "default_value": 100 },
              { "field": "is_active", "from": "is_active", "transform": "bool", "default_value": true },
              { "field": "allowed_actions_text", "from": "attrs.allowed_actions", "transform": "array_csv" },
              { "field": "completion_action", "from": "attrs.completion_action" },
              { "field": "attrs_text", "from": "attrs", "transform": "json_pretty_or_default", "default_value": {} }
            ],
            "save_payload": {
              "template": {
                "process_def_id": "$selection.id",
                "service_object_type": "$draft.service_object_type",
                "task_type": "$draft.task_type",
                "title": "$draft.title",
                "description": "$draft.description",
                "sort_order": "$draft.sort_order",
                "is_active": "$draft.is_active"
              },
              "number_fields": ["sort_order"],
              "boolean_fields": ["is_active"],
              "omit_empty_fields": ["service_object_type", "title", "description"],
              "attrs": {
                "target": "attrs",
                "json_field": "attrs_text",
                "merges": [
                  {
                    "target": "allowed_actions",
                    "from": "$draft.allowed_actions_text",
                    "transform": "comma_list",
                    "omit_empty": true
                  },
                  {
                    "target": "completion_action",
                    "from": "$draft.completion_action",
                    "omit_empty": true
                  }
                ]
              }
            },
            "deactivate_payload": {
              "is_active": false
            },
            "actions": {
              "new_label": "New",
              "refresh_label": "Refresh",
              "save_label": "Save",
              "save_busy_label": "Saving...",
              "deactivate_label": "Deactivate"
            }
          }
        },
        {
          "id": "binding_editor",
          "type": "ContractRecordEditor",
          "props": {
            "title": "Process Binding Workbench",
            "eyebrow": "Workbench Contract",
            "selection_required_path": "selection.definition.id",
            "selection_required_message": "Select a process definition to author bindings.",
            "permissions_any": ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"],
            "read_only_message": "Missing write permission for binding authoring.",
            "list_contract": {
              "endpoint": "/api/eip/process/bindings",
              "method": "GET",
              "query": {
                "process_def_id": "$selection.id"
              }
            },
            "create_contract": {
              "endpoint": "/api/eip/process/bindings",
              "method": "POST"
            },
            "update_contract": {
              "endpoint": "/api/eip/process/bindings/:id",
              "method": "PATCH"
            },
            "list_view": {
              "id_key": "id",
              "title_field": "service_object_type",
              "subtitle_field": "task_type",
              "empty_subtitle": "All tasks",
              "empty_list_message": "No process bindings found.",
              "empty_editor_message": "Choose a binding or start a new one."
            },
            "fields": [
              { "key": "service_object_type", "label": "Service Object Type", "required": true },
              { "key": "task_type", "label": "Task Type" },
              { "key": "priority", "label": "Priority", "type": "number", "default_value": 100 },
              { "key": "is_active", "label": "Is Active", "type": "checkbox", "default_value": true },
              { "key": "attrs_text", "label": "Binding Attrs (JSON)", "type": "json", "rows": 6, "default_value": "{}" }
            ],
            "item_mapping": [
              { "field": "service_object_type", "from": "service_object_type" },
              { "field": "task_type", "from": "task_type" },
              { "field": "priority", "from": "priority", "transform": "number", "default_value": 100 },
              { "field": "is_active", "from": "is_active", "transform": "bool", "default_value": true },
              { "field": "attrs_text", "from": "attrs", "transform": "json_pretty_or_default", "default_value": {} }
            ],
            "save_payload": {
              "template": {
                "process_def_id": "$selection.id",
                "service_object_type": "$draft.service_object_type",
                "task_type": "$draft.task_type",
                "priority": "$draft.priority",
                "is_active": "$draft.is_active"
              },
              "number_fields": ["priority"],
              "boolean_fields": ["is_active"],
              "omit_empty_fields": ["task_type"],
              "attrs": {
                "target": "attrs",
                "json_field": "attrs_text"
              }
            },
            "deactivate_payload": {
              "is_active": false
            },
            "actions": {
              "new_label": "New",
              "refresh_label": "Refresh",
              "save_label": "Save",
              "save_busy_label": "Saving...",
              "deactivate_label": "Deactivate"
            }
          }
        },
        {
          "id": "instance_stream",
          "type": "ContractTablePanel",
          "props": {
            "title": "Process Instance Stream",
            "eyebrow": "Workbench Contract",
            "list_contract": {
              "endpoint": "/api/eip/process/instances",
              "method": "GET"
            },
            "preloaded_items_path": "selection.detail.recent_instances",
            "columns": [
              { "key": "id", "label": "Instance Id" },
              { "key": "status", "label": "Status" },
              { "key": "service_object_id", "label": "Service Object" },
              { "key": "started_at", "label": "Started", "format": "datetime" },
              { "key": "updated_at", "label": "Updated", "format": "datetime" }
            ],
            "row_id_key": "id",
            "loading_title": "Loading process instances...",
            "empty_message": "No process instances found."
          }
        }
      ]
    }
    $json$::jsonb,
    '{"module":"ecom","surface_kind":"process_workbench","renderer_contract":"metadata_tree_v1","workbench_contract":"process_workbench_v1","realm":"EIP","surface_nav":{"label":"Ecom Workbench","order":20,"default":false,"asset_key":"surface.ecom"},"ui_composition_model":"generic_primitives_v1","source":"v2_0014"}'::jsonb
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
