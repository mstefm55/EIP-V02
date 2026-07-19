BEGIN;

WITH target AS (
  SELECT surface.code, surface.tree
  FROM eip_core.ui_surface AS surface
  WHERE surface.tenant_id IS NULL
    AND surface.version = 1
    AND surface.code IN ('core_process_workbench', 'ecom_process_workbench')
    AND jsonb_path_exists(
      surface.tree,
      '$.children[1].children[1].type ? (@ == "ContractDetailEditor")'
    )
), rewritten AS (
  SELECT
    target.code,
    jsonb_set(
      jsonb_set(
        jsonb_set(
          target.tree,
          '{children,1,children,1,props,authoring_tabs}',
          jsonb_build_object(
            'enabled', true,
            'default_tab', 'definition',
            'tabs',
            jsonb_build_array(
              jsonb_build_object('id', 'definition', 'label', 'Definition', 'icon', 'DF'),
              jsonb_build_object('id', 'flow', 'label', 'Flow Tree', 'icon', 'FL'),
              jsonb_build_object('id', 'effects', 'label', 'Macro Effects', 'icon', 'FX'),
              jsonb_build_object('id', 'advanced', 'label', 'Advanced', 'icon', 'AD')
            )
          ),
          true
        ),
        '{children,1,children,1,props,flow_tree}',
        jsonb_build_object(
          'enabled', true,
          'title', 'Top-down Flow Tree',
          'subtitle', 'Progression of nodes from the process start node.',
          'start_label', 'Start Node',
          'level_label', 'Level',
          'no_nodes_message', 'Add graph nodes to render the flow tree.'
        ),
        true
      ),
      '{children,1,children,1,props,transition_designer,subtitle}',
      to_jsonb('Build transitions with task labels and macros. The flow tree reflects the same route structure.'::text),
      true
    ) AS next_tree
  FROM target
)
UPDATE eip_core.ui_surface AS surface
SET tree = rewritten.next_tree,
    attrs = COALESCE(surface.attrs, '{}'::jsonb) || jsonb_build_object(
      'ui_composition_model', 'generic_primitives_v6',
      'source', 'v2_0022'
    ),
    updated_at = now()
FROM rewritten
WHERE surface.tenant_id IS NULL
  AND surface.version = 1
  AND surface.code = rewritten.code;

COMMIT;
