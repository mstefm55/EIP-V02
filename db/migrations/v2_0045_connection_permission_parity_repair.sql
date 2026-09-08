BEGIN;

-- EIP Core V2 — Connection Management permission parity repair.
--
-- v2_0042 granted the dedicated Connection permissions to identities carrying
-- OWNER_ADMIN_CONSOLE_READ, OWNER_ADMIN_SETTINGS_READ or OWNER_ADMIN_SECURITY_READ.
-- Existing Owner Admin identities may instead carry OWNER_ADMIN_ACCESS_READ as
-- their stable console authority. That omission allowed the metadata surface to
-- render while the bounded Connection contracts correctly failed closed.
--
-- This forward-only repair grants the dedicated Connection permission family to
-- active identities that already carry one of the canonical Owner Admin read
-- authorities. It does not broaden tenant scope and does not grant access to
-- ordinary tenant/member identities.

WITH eligible AS (
  SELECT
    identity.id,
    identity.tenant_id,
    COALESCE(identity.attrs, '{}'::jsonb) AS attrs,
    COALESCE(identity.attrs -> 'permissions', '[]'::jsonb) AS permissions
  FROM eip_auth.auth_identity AS identity
  WHERE identity.is_active = true
    AND jsonb_typeof(COALESCE(identity.attrs -> 'permissions', '[]'::jsonb)) = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(identity.attrs -> 'permissions', '[]'::jsonb)) AS permission(code)
      WHERE permission.code IN (
        'OWNER_ADMIN_CONSOLE_READ',
        'OWNER_ADMIN_ACCESS_READ',
        'OWNER_ADMIN_SETTINGS_READ',
        'OWNER_ADMIN_SECURITY_READ'
      )
    )
), merged AS (
  SELECT
    eligible.id,
    eligible.tenant_id,
    (
      SELECT jsonb_agg(permission_code ORDER BY permission_code)
      FROM (
        SELECT DISTINCT permission_code
        FROM (
          SELECT value::text AS permission_code
          FROM jsonb_array_elements_text(eligible.permissions) AS existing(value)
          UNION ALL
          SELECT unnest(ARRAY[
            'OWNER_ADMIN_CONNECTION_READ',
            'OWNER_ADMIN_CONNECTION_WRITE',
            'OWNER_ADMIN_CONNECTION_SECRET_MANAGE',
            'OWNER_ADMIN_CONNECTION_TEST'
          ]::text[])
        ) AS combined(permission_code)
      ) AS deduped
    ) AS permissions
  FROM eligible
)
UPDATE eip_auth.auth_identity AS identity
SET attrs = jsonb_set(
      COALESCE(identity.attrs, '{}'::jsonb),
      '{permissions}',
      COALESCE(merged.permissions, '[]'::jsonb),
      true
    ),
    updated_at = now()
FROM merged
WHERE identity.id = merged.id
  AND identity.tenant_id = merged.tenant_id;

COMMIT;
