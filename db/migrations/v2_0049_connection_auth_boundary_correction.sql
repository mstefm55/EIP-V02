BEGIN;

-- EIP Core V2 — Connection authentication boundary correction.
--
-- Canonical invariant:
--   * EIP interactive authentication remains the existing EIP auth/session/
--     device/CSRF/step-up flow.
--   * inbound external -> EIP connection verification is limited to the
--     governed EIP connection modes (API key, HMAC, sandbox-only none).
--   * OAuth2 client credentials remain valid only for EIP -> external provider
--     authentication where a third-party API requires them.
--
-- v2_0040 is already applied and therefore remains immutable. Correct the
-- taxonomy forward-only by deactivating the earlier oauth2_jwt inbound value.

WITH verification_lists AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE tenant_id IS NULL
    AND module = 'integration'
    AND code = 'CONNECTION_VERIFICATION_MODE'
    AND version = 1
    AND is_active = true
)
UPDATE eip_core.dropdown_value dv
SET is_active = false,
    attrs = COALESCE(dv.attrs, '{}'::jsonb)
      || '{"deprecated":true,"reason":"not_an_eip_inbound_auth_mode","replacement":null}'::jsonb,
    updated_at = now()
FROM verification_lists vl
WHERE dv.list_id = vl.id
  AND dv.code = 'oauth2_jwt';

-- Remove the obsolete inbound JWT editor fields from the metadata-composed
-- Security step. Outbound OAuth client fields remain because they describe EIP
-- authenticating to a third-party provider, not authentication into EIP.
UPDATE eip_core.ui_surface s
SET tree = jsonb_set(
      s.tree,
      '{children,1,children,1,children,1,children,2,children,0,props,fields}',
      COALESCE(
        (
          SELECT jsonb_agg(field ORDER BY ordinal)
          FROM jsonb_array_elements(
            COALESCE(
              s.tree #> '{children,1,children,1,children,1,children,2,children,0,props,fields}',
              '[]'::jsonb
            )
          ) WITH ORDINALITY AS entries(field, ordinal)
          WHERE COALESCE(field ->> 'path', '') NOT LIKE 'verification.oauth2_jwt.%'
            AND COALESCE(field ->> 'key', '') NOT LIKE 'jwt_%'
        ),
        '[]'::jsonb
      ),
      true
    ),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0049"'::jsonb, true),
    updated_at = now()
WHERE s.tenant_id IS NULL
  AND s.version = 1
  AND s.code = 'owner_connections'
  AND s.tree #>> '{props,composition}' = 'connection_setup_v2';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM eip_core.dropdown_value dv
    JOIN eip_core.dropdown_list dl ON dl.id = dv.list_id
    WHERE dl.tenant_id IS NULL
      AND dl.module = 'integration'
      AND dl.code = 'CONNECTION_VERIFICATION_MODE'
      AND dl.version = 1
      AND dv.code = 'oauth2_jwt'
      AND dv.is_active = true
  ) THEN
    RAISE EXCEPTION 'v2_0049 failed to deactivate oauth2_jwt inbound verification';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM eip_core.ui_surface
    WHERE tenant_id IS NULL
      AND version = 1
      AND code = 'owner_connections'
      AND tree::text LIKE '%verification.oauth2_jwt%'
  ) THEN
    RAISE EXCEPTION 'v2_0049 failed to remove inbound JWT fields from Connections UI';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.dropdown_value dv
    JOIN eip_core.dropdown_list dl ON dl.id = dv.list_id
    WHERE dl.tenant_id IS NULL
      AND dl.module = 'integration'
      AND dl.code = 'CONNECTION_AUTH_MODE'
      AND dl.version = 1
      AND dv.code = 'oauth2_client_credentials'
      AND dv.is_active = true
  ) THEN
    RAISE EXCEPTION 'v2_0049 must preserve outbound OAuth2 client credentials';
  END IF;
END
$$;

COMMIT;
