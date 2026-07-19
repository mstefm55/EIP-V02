BEGIN;

WITH target AS (
  SELECT
    surface.code,
    surface.tree,
    surface.attrs,
    CASE
      WHEN surface.code = 'ecom_process_workbench' THEN 'ecom'
      ELSE 'core'
    END AS module_profile
  FROM eip_core.ui_surface AS surface
  WHERE surface.tenant_id IS NULL
    AND surface.version = 1
    AND surface.code IN ('core_process_workbench', 'ecom_process_workbench')
    AND jsonb_typeof(surface.tree->'children') = 'array'
    AND jsonb_array_length(surface.tree->'children') >= 4
), rewritten AS (
  SELECT
    target.code,
    jsonb_build_object(
      'type', target.tree->>'type',
      'props', COALESCE(target.tree->'props', '{}'::jsonb),
      'children', jsonb_build_array(
        jsonb_build_object(
          'id', COALESCE(target.tree->'children'->0->>'id', 'workbench_header'),
          'type', 'PanelHeader',
          'props', jsonb_build_object(
            'title', 'Process Builder Workbench',
            'subtitle', format('Universal process builder profile (%s). Module differences are metadata-driven.', target.module_profile),
            'eyebrow', 'Universal Builder'
          )
        ),
        target.tree->'children'->1,
        jsonb_build_object(
          'id', 'workbench_right_tabs',
          'type', 'Tabs',
          'props', jsonb_build_object(
            'title', 'Workbench Panels',
            'subtitle', 'Templates, bindings, and runtime stream in one tabbed panel.',
            'eyebrow', 'Panel Tabs',
            'default_tab_id', 'templates',
            'keep_mounted', true,
            'tabs', jsonb_build_array(
              jsonb_build_object('id', 'templates', 'label', 'Templates', 'icon', 'template', 'child_id', 'task_template_editor'),
              jsonb_build_object('id', 'bindings', 'label', 'Bindings', 'icon', 'binding', 'child_id', 'binding_editor'),
              jsonb_build_object('id', 'instances', 'label', 'Instances', 'icon', 'instance', 'child_id', 'instance_stream')
            )
          ),
          'children', jsonb_build_array(
            target.tree->'children'->2->'children'->0,
            target.tree->'children'->2->'children'->1,
            target.tree->'children'->3->'children'->0
          )
        )
      )
    ) AS next_tree,
    COALESCE(target.attrs, '{}'::jsonb) || jsonb_build_object(
      'ui_composition_model', 'generic_primitives_v5',
      'workbench_model', 'universal_process_builder_v1',
      'source', 'v2_0021'
    ) AS next_attrs
  FROM target
)
UPDATE eip_core.ui_surface AS surface
SET tree = rewritten.next_tree,
    attrs = rewritten.next_attrs,
    updated_at = now()
FROM rewritten
WHERE surface.tenant_id IS NULL
  AND surface.version = 1
  AND surface.code = rewritten.code;

COMMIT;
