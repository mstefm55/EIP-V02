BEGIN;

UPDATE eip_core.ui_surface
SET attrs = jsonb_set(
      COALESCE(attrs, '{}'::jsonb),
      '{surface_nav,label}',
      to_jsonb('Processes'::text),
      true
    ),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'core_process_workbench';

UPDATE eip_core.ui_surface
SET tree = jsonb_set(
      jsonb_set(
        tree,
        '{children,0,props,title}',
        to_jsonb('Connections'::text),
        true
      ),
      '{children,0,props,subtitle}',
      to_jsonb('Gateway connections are tenant-scoped and used to connect tenant resources.'::text),
      true
    ),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_connections';

COMMIT;
