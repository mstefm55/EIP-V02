BEGIN;

-- EIP Core V2 — release enablement for the governed Connection Management surface.
--
-- v2_0040..v2_0043 established the tenant-scoped profile authority, encrypted
-- credential lifecycle, dedicated permissions, bounded API/DTO contracts and
-- metadata-driven seven-step UI composition. This migration only changes
-- navigation availability after those contracts passed the V2 governance gate.
-- It does not rewrite the surface tree or alter authorization/security policy.

DO $$
DECLARE
  surface_composition text;
  taxonomy_count integer;
BEGIN
  IF to_regclass('eip_core.ui_surface') IS NULL THEN
    RAISE EXCEPTION 'v2_0044 requires eip_core.ui_surface';
  END IF;

  IF to_regclass('tenant.connection_secret') IS NULL THEN
    RAISE EXCEPTION 'v2_0044 requires tenant.connection_secret from v2_0040';
  END IF;

  SELECT tree #>> '{props,composition}'
  INTO surface_composition
  FROM eip_core.ui_surface
  WHERE tenant_id IS NULL
    AND version = 1
    AND code = 'owner_connections'
  LIMIT 1;

  IF surface_composition IS DISTINCT FROM 'connection_setup_v1' THEN
    RAISE EXCEPTION 'v2_0044 requires owner_connections connection_setup_v1 composition';
  END IF;

  SELECT count(*)
  INTO taxonomy_count
  FROM eip_core.dropdown_list
  WHERE tenant_id IS NULL
    AND module = 'integration'
    AND version = 1
    AND is_active = true
    AND code IN (
      'CONNECTION_KIND',
      'CONNECTION_DIRECTION',
      'CONNECTION_ENVIRONMENT',
      'CONNECTION_VERIFICATION_MODE',
      'CONNECTION_AUTH_MODE',
      'CONNECTION_CHANNEL',
      'CONNECTION_MAPPING_MODE',
      'CONNECTION_HTTP_METHOD',
      'CONNECTION_LOG_LEVEL',
      'CONNECTION_SECRET_KIND'
    );

  IF taxonomy_count <> 10 THEN
    RAISE EXCEPTION 'v2_0044 requires all governed connection taxonomy lists; found % of 10', taxonomy_count;
  END IF;
END
$$;

UPDATE eip_core.ui_surface
SET attrs = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(attrs, '{}'::jsonb) #- '{surface_nav,reason}',
          '{surface_nav,enabled}',
          'true'::jsonb,
          true
        ),
        '{surface_nav,hint}',
        to_jsonb('Governed gateway and external connection profiles'::text),
        true
      ),
      '{source}',
      '"v2_0044"'::jsonb,
      true
    ),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_connections'
  AND tree #>> '{props,composition}' = 'connection_setup_v1';

IF NOT FOUND THEN
  RAISE EXCEPTION 'v2_0044 could not enable owner_connections';
END IF;

COMMIT;
