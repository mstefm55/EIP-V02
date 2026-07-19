BEGIN;

WITH target AS (
  SELECT surface.code, surface.tree
  FROM eip_core.ui_surface AS surface
  WHERE surface.tenant_id IS NULL
    AND surface.version = 1
    AND surface.code IN ('core_process_workbench', 'ecom_process_workbench')
    AND jsonb_path_exists(surface.tree, '$.children[1].children[0].type ? (@ == "ContractTablePanel")')
), rewritten AS (
  SELECT
    target.code,
    jsonb_set(
      jsonb_set(
        jsonb_set(
          target.tree,
          '{children,1,children,0,props,display_mode}',
          to_jsonb('library_cards'::text),
          true
        ),
        '{children,1,children,0,props,library_view}',
        jsonb_build_object(
          'title_field', 'name',
          'code_field', 'code',
          'version_field', 'version',
          'meta_field', 'module',
          'empty_message', 'No definitions found. Create the first process from New Definition.'
        ),
        true
      ),
      '{children,2,props,bind_to_workbench_panel}',
      'true'::jsonb,
      true
    ) AS next_tree
  FROM target
)
UPDATE eip_core.ui_surface AS surface
SET tree = rewritten.next_tree,
    attrs = COALESCE(surface.attrs, '{}'::jsonb) || jsonb_build_object(
      'ui_composition_model', 'generic_primitives_v8',
      'source', 'v2_0026'
    ),
    updated_at = now()
FROM rewritten
WHERE surface.tenant_id IS NULL
  AND surface.version = 1
  AND surface.code = rewritten.code;

COMMIT;
