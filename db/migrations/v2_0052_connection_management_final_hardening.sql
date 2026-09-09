BEGIN;

-- EIP Core V2 — Connection Management final hardening.
--
-- Consolidated repair invariants:
--   * inbound route suffixes are tenant-scoped and concurrency-safe;
--   * obsolete inbound OAuth/JWT metadata cannot persist in Connection profiles;
--   * Reliability keeps the full V1-capability set while remaining metadata-driven;
--   * browser tenant authority is never introduced.

DO $$
DECLARE
  composition text;
BEGIN
  IF to_regclass('tenant.tenant_settings') IS NULL THEN
    RAISE EXCEPTION 'v2_0052 requires tenant.tenant_settings';
  END IF;

  SELECT tree #>> '{props,composition}'
  INTO composition
  FROM eip_core.ui_surface
  WHERE tenant_id IS NULL
    AND version = 1
    AND code = 'owner_connections'
  LIMIT 1;

  IF composition IS DISTINCT FROM 'connection_setup_v2' THEN
    RAISE EXCEPTION 'v2_0052 requires owner_connections connection_setup_v2; found %', composition;
  END IF;
END
$$;

-- FORCE RLS remains authoritative. Inspect and clean one tenant at a time by
-- setting the same transaction-local tenant context used by the application.
DO $$
DECLARE
  tenant_row record;
  duplicate_suffix text;
BEGIN
  FOR tenant_row IN
    SELECT tenant_id
    FROM kernel.tenants
    ORDER BY tenant_id
  LOOP
    PERFORM set_config('app.current_tenant_id', tenant_row.tenant_id::text, true);

    SELECT suffix
    INTO duplicate_suffix
    FROM (
      SELECT setting_value #>> '{inbound,inbound_path_suffix}' AS suffix
      FROM tenant.tenant_settings
      WHERE tenant_id = tenant_row.tenant_id
        AND setting_key LIKE 'connection.profile.%'
        AND setting_status <> 'deprecated'
        AND NULLIF(btrim(setting_value #>> '{inbound,inbound_path_suffix}'), '') IS NOT NULL
      GROUP BY setting_value #>> '{inbound,inbound_path_suffix}'
      HAVING count(*) > 1
      LIMIT 1
    ) conflicts;

    IF duplicate_suffix IS NOT NULL THEN
      RAISE EXCEPTION
        'v2_0052 found duplicate inbound path suffix % for tenant %; resolve before retrying migration',
        duplicate_suffix,
        tenant_row.tenant_id;
    END IF;

    UPDATE tenant.tenant_settings
    SET setting_value = setting_value #- '{verification,oauth2_jwt}',
        updated_at = now()
    WHERE tenant_id = tenant_row.tenant_id
      AND setting_key LIKE 'connection.profile.%'
      AND setting_value #> '{verification,oauth2_jwt}' IS NOT NULL;
  END LOOP;
END
$$;

-- Final concurrency authority for tenant-local public/EDI route suffixes.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_settings_connection_inbound_path_uk
  ON tenant.tenant_settings (
    tenant_id,
    ((setting_value #>> '{inbound,inbound_path_suffix}'))
  )
  WHERE setting_key LIKE 'connection.profile.%'
    AND setting_status <> 'deprecated'
    AND NULLIF(btrim(setting_value #>> '{inbound,inbound_path_suffix}'), '') IS NOT NULL;

-- Persistence boundary: older application objects may still contain the now
-- retired verification.oauth2_jwt projection. Strip it before storage. This does
-- not affect outbound OAuth2 client-credential metadata under outbound.auth.
CREATE OR REPLACE FUNCTION tenant.connection_profile_strip_deprecated_inbound_auth()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.setting_key LIKE 'connection.profile.%' THEN
    NEW.setting_value := COALESCE(NEW.setting_value, '{}'::jsonb)
      #- '{verification,oauth2_jwt}';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_connection_profile_strip_deprecated_inbound_auth
  ON tenant.tenant_settings;

CREATE TRIGGER trg_connection_profile_strip_deprecated_inbound_auth
BEFORE INSERT OR UPDATE OF setting_key, setting_value
ON tenant.tenant_settings
FOR EACH ROW
EXECUTE FUNCTION tenant.connection_profile_strip_deprecated_inbound_auth();

-- Restore the complete Reliability editor after v2_0050 intentionally
-- re-declared the governed idempotency fields but inadvertently replaced the
-- existing rate-limit / timeout / retry controls.
UPDATE eip_core.ui_surface
SET tree = jsonb_set(
      tree,
      '{children,1,children,1,children,1,children,3,children,0,props,fields}',
      $json$
      [
        {
          "key":"event_id_location",
          "path":"idempotency.event_id_location",
          "label":"Event ID location",
          "type":"select",
          "options_path":"taxonomy.CONNECTION_EVENT_ID_LOCATION",
          "omit_empty":true,
          "help":"Choose where the external sender supplies its stable event identifier."
        },
        {
          "key":"event_id_key",
          "path":"idempotency.event_id_key",
          "label":"Event ID key",
          "omit_empty":true,
          "help":"Header name, query parameter, or dot-separated JSON body path that contains the sender's stable event ID."
        },
        {
          "key":"idempotency_scope",
          "path":"idempotency.idempotency_scope",
          "label":"Idempotency scope",
          "type":"select",
          "options_path":"taxonomy.CONNECTION_IDEMPOTENCY_SCOPE",
          "omit_empty":true,
          "help":"Connection scope isolates event IDs per connection; organisation scope shares them across this tenant."
        },
        {
          "key":"rate_limit_max",
          "path":"inbound.rate_limit.max",
          "label":"Inbound rate limit",
          "type":"number",
          "advanced":true,
          "omit_empty":true,
          "help":"Maximum inbound requests accepted in each configured rate window. Configure max and window together."
        },
        {
          "key":"rate_limit_window",
          "path":"inbound.rate_limit.window_sec",
          "label":"Rate window (sec)",
          "type":"number",
          "advanced":true,
          "omit_empty":true,
          "help":"Fixed tenant-scoped rate-limit window in seconds. Configure max and window together."
        },
        {
          "key":"timeout_ms",
          "path":"outbound.timeout_ms",
          "label":"Outbound timeout (ms)",
          "type":"number",
          "advanced":true,
          "omit_empty":true
        },
        {
          "key":"max_retries",
          "path":"outbound.retry_policy.max_retries",
          "label":"Max retries",
          "type":"number",
          "advanced":true,
          "omit_empty":true
        },
        {
          "key":"backoff_ms",
          "path":"outbound.retry_policy.backoff_ms",
          "label":"Retry backoff (ms)",
          "type":"number",
          "advanced":true,
          "omit_empty":true
        }
      ]
      $json$::jsonb,
      true
    ),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0052"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_connections'
  AND tree #>> '{props,composition}' = 'connection_setup_v2';

DO $$
BEGIN
  IF to_regclass('tenant.tenant_settings_connection_inbound_path_uk') IS NULL THEN
    RAISE EXCEPTION 'v2_0052 failed to create tenant-scoped inbound path uniqueness index';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'tenant.tenant_settings'::regclass
      AND tgname = 'trg_connection_profile_strip_deprecated_inbound_auth'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'v2_0052 failed to install inbound JWT persistence scrub trigger';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.ui_surface
    WHERE tenant_id IS NULL
      AND version = 1
      AND code = 'owner_connections'
      AND tree #>> '{props,composition}' = 'connection_setup_v2'
      AND tree::text LIKE '%idempotency.event_id_location%'
      AND tree::text LIKE '%idempotency.event_id_key%'
      AND tree::text LIKE '%idempotency.idempotency_scope%'
      AND tree::text LIKE '%inbound.rate_limit.max%'
      AND tree::text LIKE '%inbound.rate_limit.window_sec%'
      AND tree::text LIKE '%outbound.timeout_ms%'
      AND tree::text LIKE '%outbound.retry_policy.max_retries%'
      AND tree::text LIKE '%outbound.retry_policy.backoff_ms%'
      AND tree::text NOT LIKE '%verification.oauth2_jwt%'
      AND tree::text NOT LIKE '%"path": "tenant_id"%'
      AND tree::text NOT LIKE '%"key": "tenant_id"%'
  ) THEN
    RAISE EXCEPTION 'v2_0052 final Connections Reliability/UI governance validation failed';
  END IF;

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
    RAISE EXCEPTION 'v2_0052 must not reactivate inbound oauth2_jwt verification';
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
    RAISE EXCEPTION 'v2_0052 must preserve outbound OAuth2 client credentials';
  END IF;
END
$$;

COMMIT;
