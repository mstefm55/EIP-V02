BEGIN;

UPDATE eip_core.ui_surface
SET tree = jsonb_build_object(
      'type', tree->>'type',
      'props', COALESCE(tree->'props', '{}'::jsonb),
      'children', jsonb_build_array(
        tree->'children'->0,
        jsonb_build_object(
          'id', 'primary_layout',
          'type', 'SplitLayout',
          'props', jsonb_build_object(
            'columns', 2,
            'min_column_width', '360px',
            'gap', '0.8rem'
          ),
          'children', jsonb_build_array(
            tree->'children'->1,
            tree->'children'->2
          )
        ),
        jsonb_build_object(
          'id', 'secondary_layout',
          'type', 'SplitLayout',
          'props', jsonb_build_object(
            'columns', 2,
            'min_column_width', '340px',
            'gap', '0.8rem'
          ),
          'children', jsonb_build_array(
            tree->'children'->3,
            tree->'children'->4
          )
        ),
        jsonb_build_object(
          'id', 'stream_layout',
          'type', 'SplitLayout',
          'props', jsonb_build_object(
            'columns', 1,
            'min_column_width', '320px',
            'gap', '0.8rem'
          ),
          'children', jsonb_build_array(
            tree->'children'->5
          )
        )
      )
    ),
    attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object(
      'ui_composition_model', 'generic_primitives_v2',
      'source', 'v2_0015'
    ),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code IN ('core_process_workbench', 'ecom_process_workbench')
  AND jsonb_typeof(tree->'children') = 'array'
  AND jsonb_array_length(tree->'children') >= 6;

COMMIT;
