BEGIN;

WITH target AS (
  SELECT
    surface.code,
    surface.tree,
    CASE
      WHEN surface.code = 'ecom_process_workbench' THEN 'ecommerce'
      ELSE 'core'
    END AS module_profile
  FROM eip_core.ui_surface AS surface
  WHERE surface.tenant_id IS NULL
    AND surface.version = 1
    AND surface.code IN ('core_process_workbench', 'ecom_process_workbench')
), patched AS (
  SELECT
    target.code,
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              target.tree #- '{children,1,children,0,props,library_view,version_field}',
              '{children,0,props,title}',
              to_jsonb('Process Builder'::text),
              true
            ),
            '{children,0,props,eyebrow}',
            to_jsonb('Process Studio'::text),
            true
          ),
          '{children,0,props,subtitle}',
          to_jsonb(format('Build and manage tenant-scoped %s process flows.', target.module_profile)::text),
          true
        ),
        '{children,1,children,0,props,eyebrow}',
        to_jsonb('Tenant Process Library'::text),
        true
      ),
      '{children,1,children,0,props,library_view,empty_message}',
      to_jsonb('No process definitions are available for this tenant yet. Select New Definition to create the first one.'::text),
      true
    ) AS next_tree
  FROM target
)
UPDATE eip_core.ui_surface AS surface
SET tree = patched.next_tree,
    attrs = jsonb_set(
      COALESCE(surface.attrs, '{}'::jsonb),
      '{surface_nav,label}',
      to_jsonb('Processes'::text),
      true
    ) || jsonb_build_object(
      'source', 'v2_0030'
    ),
    updated_at = now()
FROM patched
WHERE surface.tenant_id IS NULL
  AND surface.version = 1
  AND surface.code = patched.code;

COMMIT;
