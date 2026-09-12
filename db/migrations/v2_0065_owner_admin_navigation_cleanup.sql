BEGIN;

-- Owner Admin V1 -> V2 migration, Wave A navigation cleanup.
--
-- `owner_integrations` was a placeholder inherited from the older V1 Admin
-- navigation. In V2, governed external transport/auth/reliability is owned by
-- the production Connections surface. Keeping both destinations would expose
-- two words for one operator responsibility and invite a second integration
-- control plane.
--
-- This migration retires only the obsolete placeholder surface. The underlying
-- Connections runtime/surface remains unchanged. No new table or authority is
-- introduced.

DO $$
BEGIN
  IF to_regclass('eip_core.ui_surface') IS NULL THEN
    RAISE EXCEPTION 'v2_0065 requires eip_core.ui_surface';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.ui_surface
    WHERE tenant_id IS NULL
      AND version = 1
      AND code = 'owner_connections'
      AND is_active = true
      AND is_published = true
      AND COALESCE(attrs #>> '{surface_nav,enabled}', 'true') = 'true'
  ) THEN
    RAISE EXCEPTION 'v2_0065 requires the governed owner_connections surface to be active and enabled';
  END IF;
END
$$;

UPDATE eip_core.ui_surface
SET is_active = false,
    attrs = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(attrs, '{}'::jsonb),
          '{source}',
          '"v2_0065"'::jsonb,
          true
        ),
        '{surface_nav,enabled}',
        'false'::jsonb,
        true
      ),
      '{surface_nav,hint}',
      to_jsonb('Superseded by Connections'::text),
      true
    ),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_integrations';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM eip_core.ui_surface
    WHERE tenant_id IS NULL
      AND version = 1
      AND code = 'owner_integrations'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'v2_0065 could not retire the superseded owner_integrations surface';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.ui_surface
    WHERE tenant_id IS NULL
      AND version = 1
      AND code = 'owner_connections'
      AND is_active = true
      AND is_published = true
      AND COALESCE(attrs #>> '{surface_nav,enabled}', 'true') = 'true'
  ) THEN
    RAISE EXCEPTION 'v2_0065 must not disable owner_connections';
  END IF;
END
$$;

COMMIT;
