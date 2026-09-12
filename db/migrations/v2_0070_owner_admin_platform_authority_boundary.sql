BEGIN;

-- EIP Core V2 — separate platform onboarding authority from tenant Owner Admin.
--
-- kernel.tenant_request is deliberately pre-tenant/global. Reviewing that queue
-- is therefore platform control-plane authority, not tenant Owner Admin authority.
-- This migration fails closed: legacy/global queue grants are removed from all
-- identities and the explicit platform permission must be re-granted only to the
-- intended platform operator by the guarded Owner Admin repair command.

-- Remove legacy leaked grants and any pre-existing platform grants. Deployment
-- must explicitly opt the intended platform operator back in after migrations.
WITH sanitized AS (
  SELECT
    identity.id,
    identity.tenant_id,
    ARRAY(
      SELECT permission_code
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(identity.attrs->'permissions') = 'array'
            THEN identity.attrs->'permissions'
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY AS permission(permission_code, ordinal_position)
      WHERE upper(btrim(permission_code)) NOT IN (
        'OWNER_ADMIN_TENANT_REQUEST_READ',
        'OWNER_ADMIN_TENANT_REQUEST_WRITE',
        'PLATFORM_TENANT_REQUEST_READ',
        'PLATFORM_TENANT_REQUEST_WRITE'
      )
      ORDER BY ordinal_position
    )::text[] AS permissions
  FROM eip_auth.auth_identity AS identity
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(identity.attrs->'permissions') = 'array'
          THEN identity.attrs->'permissions'
        ELSE '[]'::jsonb
      END
    ) AS permission(permission_code)
    WHERE upper(btrim(permission_code)) IN (
      'OWNER_ADMIN_TENANT_REQUEST_READ',
      'OWNER_ADMIN_TENANT_REQUEST_WRITE',
      'PLATFORM_TENANT_REQUEST_READ',
      'PLATFORM_TENANT_REQUEST_WRITE'
    )
  )
)
UPDATE eip_auth.auth_identity AS identity
SET attrs = jsonb_set(
      COALESCE(identity.attrs, '{}'::jsonb),
      '{permissions}',
      to_jsonb(sanitized.permissions),
      true
    ),
    updated_at = now()
FROM sanitized
WHERE identity.id = sanitized.id
  AND identity.tenant_id = sanitized.tenant_id;

-- Make the metadata contract explicit. The current UI catalog does not yet use
-- requires_any_permission for catalog filtering, but the surface and all write
-- actions now declare platform authority rather than tenant Owner Admin authority.
UPDATE eip_core.ui_surface
SET tree = jsonb_set(
      replace(
        tree::text,
        '"OWNER_ADMIN_TENANT_REQUEST_WRITE"',
        '"PLATFORM_TENANT_REQUEST_WRITE"'
      )::jsonb,
      '{props,permissions_any}',
      '["PLATFORM_TENANT_REQUEST_READ"]'::jsonb,
      true
    ),
    attrs = jsonb_set(
      jsonb_set(
        COALESCE(attrs, '{}'::jsonb),
        '{source}',
        '"v2_0070"'::jsonb,
        true
      ),
      '{surface_nav}',
      COALESCE(attrs->'surface_nav', '{}'::jsonb)
        || '{"requires_any_permission":["PLATFORM_TENANT_REQUEST_READ"]}'::jsonb,
      true
    ),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_tenant_requests';

DO $$
DECLARE
  surface_tree jsonb;
BEGIN
  SELECT tree
  INTO surface_tree
  FROM eip_core.ui_surface
  WHERE tenant_id IS NULL
    AND version = 1
    AND code = 'owner_tenant_requests'
  LIMIT 1;

  IF surface_tree IS NULL THEN
    RAISE EXCEPTION 'v2_0070 requires global owner_tenant_requests surface';
  END IF;

  IF surface_tree::text LIKE '%OWNER_ADMIN_TENANT_REQUEST_WRITE%' THEN
    RAISE EXCEPTION 'v2_0070 could not remove legacy tenant-request write authority from surface metadata';
  END IF;

  IF surface_tree::text NOT LIKE '%PLATFORM_TENANT_REQUEST_WRITE%' THEN
    RAISE EXCEPTION 'v2_0070 could not bind tenant-request surface actions to platform authority';
  END IF;
END
$$;

COMMIT;
