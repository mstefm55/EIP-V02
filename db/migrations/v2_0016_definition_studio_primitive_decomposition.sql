BEGIN;

WITH definition_nodes AS (
  SELECT
    'core_process_workbench'::text AS code,
    $json$
    {
      "id": "definition_studio",
      "type": "ContractDetailEditor",
      "props": {
        "title": "Definition Studio",
        "eyebrow": "Workbench Contract",
        "selection": {
          "target": "definition",
          "id_key": "id",
          "label_path": "code",
          "new_label": "New Draft"
        },
        "permissions_any": ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"],
        "read_only_message": "This session lacks PROCESS_DEF_WRITE/CRM_PROCESS_DEF_WRITE.",
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
        },
        "groups": [
          { "id": "core", "layout_class": "form-grid" },
          { "id": "line", "layout_class": "stack" },
          { "id": "json", "layout_class": "editor-grid" }
        ],
        "fields": [
          { "key": "code", "label": "Code", "type": "text", "group": "core", "disabled_when_existing": true, "source_path": "code", "default_value": "" },
          { "key": "name", "label": "Name", "type": "text", "group": "core", "source_path": "name", "default_value": "" },
          { "key": "module", "label": "Module", "type": "text", "group": "core", "source_path": "attrs.module", "default_value": "$surface.module" },
          { "key": "version", "label": "Version", "type": "number", "group": "core", "source_path": "version", "default_value": 1, "disabled_when_existing": true },
          { "key": "object_type", "label": "Service Object Type", "type": "text", "group": "core", "source_path": "graph.object_type", "default_value": "" },
          { "key": "service_object_category", "label": "Service Object Category", "type": "text", "group": "core", "source_path": "attrs.service_object_category", "default_value": "" },
          { "key": "is_active", "label": "Active", "type": "checkbox", "group": "core", "source_path": "is_active", "default_value": true },
          { "key": "is_published", "label": "Published Flag", "type": "checkbox", "group": "core", "source_path": "attrs.is_published", "default_value": false },
          { "key": "graph_initial_node", "label": "Graph Initial Node", "type": "text", "group": "line", "source_path": "graph.initial_node", "default_value": "" },
          { "key": "graph_nodes_text", "label": "Graph Nodes (JSON)", "type": "json", "group": "json", "rows": 8, "source_path": "graph.nodes", "default_value": [] },
          { "key": "graph_transitions_text", "label": "Graph Transitions (JSON)", "type": "json", "group": "json", "rows": 8, "source_path": "graph.transitions", "default_value": [] },
          { "key": "graph_macros_text", "label": "Graph Macros (JSON)", "type": "json", "group": "json", "rows": 8, "source_path": "graph.macros", "default_value": {} },
          { "key": "attrs_text", "label": "Attrs (JSON)", "type": "json", "group": "json", "rows": 8, "source_path": "attrs", "default_value": {} }
        ],
        "json_fields": [
          { "key": "graph_nodes_text", "label": "Graph Nodes (JSON)", "fallback": [] },
          { "key": "graph_transitions_text", "label": "Graph Transitions (JSON)", "fallback": [] },
          { "key": "graph_macros_text", "label": "Graph Macros (JSON)", "fallback": {} },
          { "key": "attrs_text", "label": "Attrs (JSON)", "fallback": {} }
        ],
        "create_required_fields": ["code", "name"],
        "create_required_message": "Code and Name are required for a new definition.",
        "save_payload": {
          "create_template": {
            "code": "$draft.code",
            "name": "$draft.name",
            "module": "$draft.module",
            "version": "$draft.version",
            "is_active": "$draft.is_active",
            "is_published": "$draft.is_published",
            "object_type": "$draft.object_type",
            "graph": {
              "object_type": "$draft.object_type",
              "initial_node": "$draft.graph_initial_node",
              "nodes": "$json.graph_nodes_text",
              "transitions": "$json.graph_transitions_text",
              "macros": "$json.graph_macros_text"
            },
            "attrs": {}
          },
          "update_template": {
            "name": "$draft.name",
            "module": "$draft.module",
            "object_type": "$draft.object_type",
            "is_active": "$draft.is_active",
            "is_published": "$draft.is_published",
            "graph": {
              "object_type": "$draft.object_type",
              "initial_node": "$draft.graph_initial_node",
              "nodes": "$json.graph_nodes_text",
              "transitions": "$json.graph_transitions_text",
              "macros": "$json.graph_macros_text"
            },
            "attrs": {}
          },
          "object_merges": [
            {
              "target_path": "attrs",
              "from_json_field": "attrs_text"
            },
            {
              "target_path": "attrs",
              "merge_template": {
                "module": "$draft.module",
                "object_type": "$draft.object_type",
                "service_object_category": "$draft.service_object_category",
                "is_published": "$draft.is_published"
              }
            }
          ],
          "omit_empty_paths": [
            "module",
            "object_type",
            "graph.object_type",
            "graph.initial_node",
            "attrs.module",
            "attrs.object_type",
            "attrs.service_object_category"
          ]
        },
        "actions": {
          "new_label": "New",
          "refresh_label": "Refresh",
          "save_label": "Save Draft",
          "save_busy_label": "Saving...",
          "created_message": "Definition created.",
          "saved_message": "Definition saved."
        },
        "extra_actions": [
          {
            "key": "validate",
            "label": "Validate",
            "busy_label": "Validating...",
            "contract_key": "validate_contract",
            "requires_existing": true,
            "requires_existing_message": "Save the definition first before validating.",
            "status_from_result_valid": true,
            "valid_message": "Validation passed.",
            "invalid_message": "Validation failed. Review returned errors.",
            "store_result_as": "validation"
          },
          {
            "key": "publish",
            "label": "Publish",
            "busy_label": "Publishing...",
            "primary": true,
            "contract_key": "publish_contract",
            "requires_existing": true,
            "requires_existing_message": "Save the definition first before publishing.",
            "requires_write": true,
            "success_message": "Definition published.",
            "patch_draft": { "is_published": true },
            "reload_on_success": true,
            "refresh_workbench": true
          }
        ],
        "taxonomy": {
          "title": "Governed Taxonomy Hints",
          "loading_title": "Loading taxonomy...",
          "rows": [
            { "label": "Node Types", "code": "PROCESS_NODE_TYPE" },
            { "label": "Edge Types", "code": "PROCESS_EDGE_TYPE" },
            { "label": "Effect Types", "code": "PROCESS_EFFECT_TYPE" },
            { "label": "Task Actions", "code": "TASK_ACTION" }
          ]
        },
        "projection": {
          "title": "Current Projection",
          "rows": [
            { "label": "Task Labels", "path": "graph_inspection.task_labels", "format": "array_csv" },
            { "label": "Macros", "path": "graph_inspection.macros", "format": "array_object_key", "item_key": "macro_code" },
            { "label": "Effect Refs", "path": "graph_inspection.effect_references", "format": "array_object_key", "item_key": "canonical_effect_code" }
          ]
        }
      }
    }
    $json$::jsonb AS node
  UNION ALL
  SELECT
    'ecom_process_workbench'::text,
    $json$
    {
      "id": "definition_studio",
      "type": "ContractDetailEditor",
      "props": {
        "title": "Definition Studio",
        "eyebrow": "Workbench Contract",
        "selection": {
          "target": "definition",
          "id_key": "id",
          "label_path": "code",
          "new_label": "New Draft"
        },
        "permissions_any": ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"],
        "read_only_message": "This session lacks PROCESS_DEF_WRITE/CRM_PROCESS_DEF_WRITE.",
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
        },
        "groups": [
          { "id": "core", "layout_class": "form-grid" },
          { "id": "line", "layout_class": "stack" },
          { "id": "json", "layout_class": "editor-grid" }
        ],
        "fields": [
          { "key": "code", "label": "Code", "type": "text", "group": "core", "disabled_when_existing": true, "source_path": "code", "default_value": "" },
          { "key": "name", "label": "Name", "type": "text", "group": "core", "source_path": "name", "default_value": "" },
          { "key": "module", "label": "Module", "type": "text", "group": "core", "source_path": "attrs.module", "default_value": "ecom" },
          { "key": "version", "label": "Version", "type": "number", "group": "core", "source_path": "version", "default_value": 1, "disabled_when_existing": true },
          { "key": "object_type", "label": "Service Object Type", "type": "text", "group": "core", "source_path": "graph.object_type", "default_value": "" },
          { "key": "service_object_category", "label": "Service Object Category", "type": "text", "group": "core", "source_path": "attrs.service_object_category", "default_value": "" },
          { "key": "is_active", "label": "Active", "type": "checkbox", "group": "core", "source_path": "is_active", "default_value": true },
          { "key": "is_published", "label": "Published Flag", "type": "checkbox", "group": "core", "source_path": "attrs.is_published", "default_value": false },
          { "key": "graph_initial_node", "label": "Graph Initial Node", "type": "text", "group": "line", "source_path": "graph.initial_node", "default_value": "" },
          { "key": "graph_nodes_text", "label": "Graph Nodes (JSON)", "type": "json", "group": "json", "rows": 8, "source_path": "graph.nodes", "default_value": [] },
          { "key": "graph_transitions_text", "label": "Graph Transitions (JSON)", "type": "json", "group": "json", "rows": 8, "source_path": "graph.transitions", "default_value": [] },
          { "key": "graph_macros_text", "label": "Graph Macros (JSON)", "type": "json", "group": "json", "rows": 8, "source_path": "graph.macros", "default_value": {} },
          { "key": "attrs_text", "label": "Attrs (JSON)", "type": "json", "group": "json", "rows": 8, "source_path": "attrs", "default_value": {} }
        ],
        "json_fields": [
          { "key": "graph_nodes_text", "label": "Graph Nodes (JSON)", "fallback": [] },
          { "key": "graph_transitions_text", "label": "Graph Transitions (JSON)", "fallback": [] },
          { "key": "graph_macros_text", "label": "Graph Macros (JSON)", "fallback": {} },
          { "key": "attrs_text", "label": "Attrs (JSON)", "fallback": {} }
        ],
        "create_required_fields": ["code", "name"],
        "create_required_message": "Code and Name are required for a new definition.",
        "save_payload": {
          "create_template": {
            "code": "$draft.code",
            "name": "$draft.name",
            "module": "$draft.module",
            "version": "$draft.version",
            "is_active": "$draft.is_active",
            "is_published": "$draft.is_published",
            "object_type": "$draft.object_type",
            "graph": {
              "object_type": "$draft.object_type",
              "initial_node": "$draft.graph_initial_node",
              "nodes": "$json.graph_nodes_text",
              "transitions": "$json.graph_transitions_text",
              "macros": "$json.graph_macros_text"
            },
            "attrs": {}
          },
          "update_template": {
            "name": "$draft.name",
            "module": "$draft.module",
            "object_type": "$draft.object_type",
            "is_active": "$draft.is_active",
            "is_published": "$draft.is_published",
            "graph": {
              "object_type": "$draft.object_type",
              "initial_node": "$draft.graph_initial_node",
              "nodes": "$json.graph_nodes_text",
              "transitions": "$json.graph_transitions_text",
              "macros": "$json.graph_macros_text"
            },
            "attrs": {}
          },
          "object_merges": [
            {
              "target_path": "attrs",
              "from_json_field": "attrs_text"
            },
            {
              "target_path": "attrs",
              "merge_template": {
                "module": "$draft.module",
                "object_type": "$draft.object_type",
                "service_object_category": "$draft.service_object_category",
                "is_published": "$draft.is_published"
              }
            }
          ],
          "omit_empty_paths": [
            "module",
            "object_type",
            "graph.object_type",
            "graph.initial_node",
            "attrs.module",
            "attrs.object_type",
            "attrs.service_object_category"
          ]
        },
        "actions": {
          "new_label": "New",
          "refresh_label": "Refresh",
          "save_label": "Save Draft",
          "save_busy_label": "Saving...",
          "created_message": "Definition created.",
          "saved_message": "Definition saved."
        },
        "extra_actions": [
          {
            "key": "validate",
            "label": "Validate",
            "busy_label": "Validating...",
            "contract_key": "validate_contract",
            "requires_existing": true,
            "requires_existing_message": "Save the definition first before validating.",
            "status_from_result_valid": true,
            "valid_message": "Validation passed.",
            "invalid_message": "Validation failed. Review returned errors.",
            "store_result_as": "validation"
          },
          {
            "key": "publish",
            "label": "Publish",
            "busy_label": "Publishing...",
            "primary": true,
            "contract_key": "publish_contract",
            "requires_existing": true,
            "requires_existing_message": "Save the definition first before publishing.",
            "requires_write": true,
            "success_message": "Definition published.",
            "patch_draft": { "is_published": true },
            "reload_on_success": true,
            "refresh_workbench": true
          }
        ],
        "taxonomy": {
          "title": "Governed Taxonomy Hints",
          "loading_title": "Loading taxonomy...",
          "rows": [
            { "label": "Node Types", "code": "PROCESS_NODE_TYPE" },
            { "label": "Edge Types", "code": "PROCESS_EDGE_TYPE" },
            { "label": "Effect Types", "code": "PROCESS_EFFECT_TYPE" },
            { "label": "Task Actions", "code": "TASK_ACTION" }
          ]
        },
        "projection": {
          "title": "Current Projection",
          "rows": [
            { "label": "Task Labels", "path": "graph_inspection.task_labels", "format": "array_csv" },
            { "label": "Macros", "path": "graph_inspection.macros", "format": "array_object_key", "item_key": "macro_code" },
            { "label": "Effect Refs", "path": "graph_inspection.effect_references", "format": "array_object_key", "item_key": "canonical_effect_code" }
          ]
        }
      }
    }
    $json$::jsonb
)
UPDATE eip_core.ui_surface surface
SET tree = jsonb_set(surface.tree, '{children,1,children,1}', definition_nodes.node, false),
    attrs = COALESCE(surface.attrs, '{}'::jsonb) || jsonb_build_object(
      'ui_composition_model', 'generic_primitives_v4',
      'source', 'v2_0016'
    ),
    updated_at = now()
FROM definition_nodes
WHERE surface.tenant_id IS NULL
  AND surface.version = 1
  AND surface.code = definition_nodes.code
  AND jsonb_path_exists(surface.tree, '$.children[1].children[1]');

COMMIT;
