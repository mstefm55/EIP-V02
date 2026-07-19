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
          "type": "ProcessWorkbenchCatalog",
          "props": {
            "title": "Process Catalog",
            "eyebrow": "Workbench Contract",
            "data_source": {
              "endpoint": "/api/eip/process/workbench/catalog",
              "method": "GET",
              "query": {
                "module": "$surface.default_module_filter"
              }
            },
            "fields": [
              "code",
              "name",
              "module",
              "object_type",
              "service_object_category",
              "graph_summary",
              "workbench_counts"
            ],
            "selection_key": "id"
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
          "id": "task_template_workbench",
          "type": "TaskTemplateWorkbench",
          "props": {
            "title": "Task Template Workbench",
            "eyebrow": "Workbench Contract",
            "list_contract": {
              "endpoint": "/api/eip/process/task-templates",
              "method": "GET"
            },
            "create_contract": {
              "endpoint": "/api/eip/process/task-templates",
              "method": "POST"
            },
            "update_contract": {
              "endpoint": "/api/eip/process/task-templates/:id",
              "method": "PATCH"
            }
          }
        },
        {
          "id": "binding_workbench",
          "type": "ProcessBindingWorkbench",
          "props": {
            "title": "Process Binding Workbench",
            "eyebrow": "Workbench Contract",
            "list_contract": {
              "endpoint": "/api/eip/process/bindings",
              "method": "GET"
            },
            "create_contract": {
              "endpoint": "/api/eip/process/bindings",
              "method": "POST"
            },
            "update_contract": {
              "endpoint": "/api/eip/process/bindings/:id",
              "method": "PATCH"
            }
          }
        },
        {
          "id": "instance_stream",
          "type": "ProcessInstanceStream",
          "props": {
            "title": "Process Instance Stream",
            "eyebrow": "Workbench Contract",
            "list_contract": {
              "endpoint": "/api/eip/process/instances",
              "method": "GET"
            },
            "advance_contract": {
              "endpoint": "/api/eip/process/instances/:id/advance",
              "method": "POST"
            }
          }
        }
      ]
    }
    $json$::jsonb,
    '{"module":"process","surface_kind":"process_workbench","renderer_contract":"metadata_tree_v1","workbench_contract":"process_workbench_v1","realm":"EIP","surface_nav":{"label":"Core Workbench","order":10,"default":true,"asset_key":"surface.process"},"source":"v2_0013"}'::jsonb
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
          "type": "ProcessWorkbenchCatalog",
          "props": {
            "title": "Process Catalog",
            "eyebrow": "Workbench Contract",
            "data_source": {
              "endpoint": "/api/eip/process/workbench/catalog",
              "method": "GET",
              "query": {
                "module": "ecom"
              }
            },
            "fields": [
              "code",
              "name",
              "object_type",
              "service_object_category",
              "graph_summary",
              "workbench_counts"
            ],
            "selection_key": "id"
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
          "id": "task_template_workbench",
          "type": "TaskTemplateWorkbench",
          "props": {
            "title": "Task Template Workbench",
            "eyebrow": "Workbench Contract",
            "list_contract": {
              "endpoint": "/api/eip/process/task-templates",
              "method": "GET",
              "query": {
                "service_object_type": "$selection.object_type"
              }
            },
            "create_contract": {
              "endpoint": "/api/eip/process/task-templates",
              "method": "POST"
            },
            "update_contract": {
              "endpoint": "/api/eip/process/task-templates/:id",
              "method": "PATCH"
            }
          }
        },
        {
          "id": "binding_workbench",
          "type": "ProcessBindingWorkbench",
          "props": {
            "title": "Process Binding Workbench",
            "eyebrow": "Workbench Contract",
            "list_contract": {
              "endpoint": "/api/eip/process/bindings",
              "method": "GET",
              "query": {
                "service_object_type": "$selection.object_type"
              }
            },
            "create_contract": {
              "endpoint": "/api/eip/process/bindings",
              "method": "POST"
            },
            "update_contract": {
              "endpoint": "/api/eip/process/bindings/:id",
              "method": "PATCH"
            }
          }
        },
        {
          "id": "instance_stream",
          "type": "ProcessInstanceStream",
          "props": {
            "title": "Process Instance Stream",
            "eyebrow": "Workbench Contract",
            "list_contract": {
              "endpoint": "/api/eip/process/instances",
              "method": "GET"
            },
            "advance_contract": {
              "endpoint": "/api/eip/process/instances/:id/advance",
              "method": "POST"
            }
          }
        }
      ]
    }
    $json$::jsonb,
    '{"module":"ecom","surface_kind":"process_workbench","renderer_contract":"metadata_tree_v1","workbench_contract":"process_workbench_v1","realm":"EIP","surface_nav":{"label":"Ecom Workbench","order":20,"default":false,"asset_key":"surface.ecom"},"source":"v2_0013"}'::jsonb
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
