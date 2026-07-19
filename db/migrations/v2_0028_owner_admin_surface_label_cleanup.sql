BEGIN;

WITH target AS (
  SELECT code, title, tree
  FROM eip_core.ui_surface
  WHERE tenant_id IS NULL
    AND version = 1
    AND code LIKE 'owner\_%' ESCAPE '\'
), patched AS (
  SELECT
    code,
    jsonb_set(
      jsonb_set(
        tree,
        '{children,1,props,title}',
        to_jsonb(title),
        true
      ),
      '{children,1,props,eyebrow}',
      to_jsonb('Business Records'::text),
      true
    ) AS next_tree
  FROM target
)
UPDATE eip_core.ui_surface AS surface
SET tree = patched.next_tree,
    updated_at = now()
FROM patched
WHERE surface.tenant_id IS NULL
  AND surface.version = 1
  AND surface.code = patched.code;

UPDATE eip_core.ui_surface
SET tree = jsonb_set(
      tree,
      '{children,0,props,subtitle}',
      to_jsonb('Gateway connections are tenant-scoped and govern tenant resource endpoints.'::text),
      true
    ),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_connections';

COMMIT;
