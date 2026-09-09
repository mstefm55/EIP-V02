BEGIN;

-- EIP Core V2 — Connection Management permission authority repair.
--
-- The runtime permission resolver accepts five bounded metadata buckets:
--   attrs.permissions
--   attrs.permission_codes
--   attrs.permissionCodes
--   attrs.authz.permissions
--   attrs.auth.permissions
--
-- Earlier Connection permission backfills inspected only attrs.permissions.
-- Preserve that runtime compatibility while converging the dedicated
-- Connection capabilities into the canonical attrs.permissions bucket.
--
-- Eligibility remains exactly the established Owner Admin authority set from
-- v2_0045. This migration does not grant Connection permissions to ordinary
-- tenant/member identities and does not change tenant/session authority.

WITH identity_permissions AS (
  SELECT
    identity.id,
    identity.tenant_id,
    COALESCE(identity.attrs, '{}'::jsonb) AS attrs,
    CASE
      WHEN jsonb_typeof(COALESCE(identity.attrs, '{}'::jsonb) -> 'permissions') = 'array'
        THEN COALESCE(identity.attrs, '{}'::jsonb) -> 'permissions'
      ELSE '[]'::jsonb
    END AS canonical_permissions,
    (
      SELECT COALESCE(jsonb_agg(permission_code ORDER BY permission_code), '[]'::jsonb)
      FROM (
        SELECT DISTINCT permission_code
        FROM (
          SELECT value AS permission_code
          FROM jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(COALESCE(identity.attrs, '{}'::jsonb) -> 'permissions') = 'array'
                THEN COALESCE(identity.attrs, '{}'::jsonb) -> 'permissions'
              ELSE '[]'::jsonb
            END
          ) AS bucket(value)

          UNION ALL

          SELECT value AS permission_code
          FROM jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(COALESCE(identity.attrs, '{}'::jsonb) -> 'permission_codes') = 'array'
                THEN COALESCE(identity.attrs, '{}'::jsonb) -> 'permission_codes'
              ELSE '[]'::jsonb
            END
          ) AS bucket(value)

          UNION ALL

          SELECT value AS permission_code
          FROM jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(COALESCE(identity.attrs, '{}'::jsonb) -> 'permissionCodes') = 'array'
                THEN COALESCE(identity.attrs, '{}'::jsonb) -> 'permissionCodes'
              ELSE '[]'::jsonb
            END
          ) AS bucket(value)

          UNION ALL

          SELECT value AS permission_code
          FROM jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(COALESCE(identity.attrs, '{}'::jsonb) #> '{authz,permissions}') = 'array'
                THEN COALESCE(identity.attrs, '{}'::jsonb) #> '{authz,permissions}'
              ELSE '[]'::jsonb
            END
          ) AS bucket(value)

          UNION ALL

          SELECT value AS permission_code
          FROM jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(COALESCE(identity.attrs, '{}'::jsonb) #> '{auth,permissions}') = 'array'
                THEN COALESCE(identity.attrs, '{}'::jsonb) #> '{auth,permissions}'
              ELSE '[]'::jsonb
            END
          ) AS bucket(value)
        ) AS combined
        WHERE NULLIF(btrim(permission_code), '') IS NOT NULL
      ) AS deduped
    ) AS effective_permissions
  FROM eip_auth.auth_identity AS identity
  WHERE identity.is_active = true
), eligible AS (
  SELECT *
  FROM identity_permissions
  WHERE effective_permissions ?| ARRAY[
    'OWNER_ADMIN_CONSOLE_READ',
    'OWNER_ADMIN_ACCESS_READ',
    'OWNER_ADMIN_SETTINGS_READ',
    'OWNER_ADMIN_SECURITY_READ'
  ]::text[]
), merged AS (
  SELECT
    eligible.id,
    eligible.tenant_id,
    eligible.attrs,
    (
      SELECT COALESCE(jsonb_agg(permission_code ORDER BY permission_code), '[]'::jsonb)
      FROM (
        SELECT DISTINCT permission_code
        FROM (
          SELECT value AS permission_code
          FROM jsonb_array_elements_text(eligible.canonical_permissions) AS existing(value)

          UNION ALL

          SELECT unnest(ARRAY[
            'OWNER_ADMIN_CONNECTION_READ',
            'OWNER_ADMIN_CONNECTION_WRITE',
            'OWNER_ADMIN_CONNECTION_SECRET_MANAGE',
            'OWNER_ADMIN_CONNECTION_TEST'
          ]::text[])
        ) AS combined
      ) AS deduped
    ) AS canonical_permissions
  FROM eligible
)
UPDATE eip_auth.auth_identity AS identity
SET attrs = jsonb_set(
      merged.attrs,
      '{permissions}',
      merged.canonical_permissions,
      true
    ),
    updated_at = now()
FROM merged
WHERE identity.id = merged.id
  AND identity.tenant_id = merged.tenant_id;

-- Fail closed if any active identity recognised by the runtime as carrying a
-- canonical Owner Admin read authority still lacks any dedicated Connection
-- capability after the repair.
DO $$
BEGIN
  IF EXISTS (
    WITH effective AS (
      SELECT
        identity.id,
        (
          SELECT COALESCE(jsonb_agg(permission_code ORDER BY permission_code), '[]'::jsonb)
          FROM (
            SELECT DISTINCT permission_code
            FROM (
              SELECT value AS permission_code
              FROM jsonb_array_elements_text(
                CASE
                  WHEN jsonb_typeof(COALESCE(identity.attrs, '{}'::jsonb) -> 'permissions') = 'array'
                    THEN COALESCE(identity.attrs, '{}'::jsonb) -> 'permissions'
                  ELSE '[]'::jsonb
                END
              ) AS bucket(value)

              UNION ALL

              SELECT value AS permission_code
              FROM jsonb_array_elements_text(
                CASE
                  WHEN jsonb_typeof(COALESCE(identity.attrs, '{}'::jsonb) -> 'permission_codes') = 'array'
                    THEN COALESCE(identity.attrs, '{}'::jsonb) -> 'permission_codes'
                  ELSE '[]'::jsonb
                END
              ) AS bucket(value)

              UNION ALL

              SELECT value AS permission_code
              FROM jsonb_array_elements_text(
                CASE
                  WHEN jsonb_typeof(COALESCE(identity.attrs, '{}'::jsonb) -> 'permissionCodes') = 'array'
                    THEN COALESCE(identity.attrs, '{}'::jsonb) -> 'permissionCodes'
                  ELSE '[]'::jsonb
                END
              ) AS bucket(value)

              UNION ALL

              SELECT value AS permission_code
              FROM jsonb_array_elements_text(
                CASE
                  WHEN jsonb_typeof(COALESCE(identity.attrs, '{}'::jsonb) #> '{authz,permissions}') = 'array'
                    THEN COALESCE(identity.attrs, '{}'::jsonb) #> '{authz,permissions}'
                  ELSE '[]'::jsonb
                END
              ) AS bucket(value)

              UNION ALL

              SELECT value AS permission_code
              FROM jsonb_array_elements_text(
                CASE
                  WHEN jsonb_typeof(COALESCE(identity.attrs, '{}'::jsonb) #> '{auth,permissions}') = 'array'
                    THEN COALESCE(identity.attrs, '{}'::jsonb) #> '{auth,permissions}'
                  ELSE '[]'::jsonb
                END
              ) AS bucket(value)
            ) AS combined
            WHERE NULLIF(btrim(permission_code), '') IS NOT NULL
          ) AS deduped
        ) AS permissions
      FROM eip_auth.auth_identity AS identity
      WHERE identity.is_active = true
    )
    SELECT 1
    FROM effective
    WHERE permissions ?| ARRAY[
      'OWNER_ADMIN_CONSOLE_READ',
      'OWNER_ADMIN_ACCESS_READ',
      'OWNER_ADMIN_SETTINGS_READ',
      'OWNER_ADMIN_SECURITY_READ'
    ]::text[]
      AND NOT permissions ?& ARRAY[
        'OWNER_ADMIN_CONNECTION_READ',
        'OWNER_ADMIN_CONNECTION_WRITE',
        'OWNER_ADMIN_CONNECTION_SECRET_MANAGE',
        'OWNER_ADMIN_CONNECTION_TEST'
      ]::text[]
  ) THEN
    RAISE EXCEPTION 'v2_0053 failed to align dedicated Connection permissions with effective Owner Admin authority';
  END IF;
END
$$;

COMMIT;
