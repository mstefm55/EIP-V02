BEGIN;

-- EIP Core V2 — Connections zero-pending closure.
--
-- This forward-only closeout removes three operator/runtime drift seams that
-- remained after the executable runtime and operator-UI waves:
--   1. the old whole-root attrs editor could overwrite governed execution
--      metadata written by the explicit Endpoint/Security fields;
--   2. raw_body_required and outbound public_key_ref were legacy profile knobs
--      with no independent runtime behavior in the canonical V2 engine;
--   3. endpoint health probes are deliberately non-mutating and therefore must
--      only offer GET/HEAD, while the separate authenticated request test owns
--      mutating-method execution.
--
-- No new table is introduced. Tenant authority remains server-side and the
-- existing tenant_settings / connection_secret boundaries remain canonical.

DO $$
DECLARE
  composition text;
BEGIN
  SELECT tree #>> '{props,composition}'
  INTO composition
  FROM eip_core.ui_surface
  WHERE tenant_id IS NULL
    AND version = 1
    AND code = 'owner_connections'
  LIMIT 1;

  IF composition IS DISTINCT FROM 'connection_setup_v2' THEN
    RAISE EXCEPTION 'v2_0062 requires owner_connections connection_setup_v2; found %', composition;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.close_connection_operator_fields(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  kind text;
  object_key text;
  object_value jsonb;
  output jsonb;
  fields jsonb;
BEGIN
  IF node IS NULL THEN
    RETURN node;
  END IF;

  kind := jsonb_typeof(node);

  IF kind = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(pg_temp.close_connection_operator_fields(items.value) ORDER BY items.ord),
      '[]'::jsonb
    )
    INTO output
    FROM jsonb_array_elements(node) WITH ORDINALITY AS items(value, ord);
    RETURN output;
  END IF;

  IF kind <> 'object' THEN
    RETURN node;
  END IF;

  output := '{}'::jsonb;
  FOR object_key, object_value IN
    SELECT pair.key, pair.value
    FROM jsonb_each(node) AS pair(key, value)
  LOOP
    output := output || jsonb_build_object(
      object_key,
      pg_temp.close_connection_operator_fields(object_value)
    );
  END LOOP;

  IF output ->> 'type' = 'ContractFlowStepEditor'
     AND jsonb_typeof(output #> '{props,fields}') = 'array'
  THEN
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN item.value ->> 'key' = 'test_request_method' THEN
            ((item.value - 'options_path') || jsonb_build_object(
              'default_value', 'HEAD',
              'options', jsonb_build_array(
                jsonb_build_object('value', 'HEAD', 'label', 'HEAD'),
                jsonb_build_object('value', 'GET', 'label', 'GET')
              ),
              'help', 'Health checks are non-mutating and use GET or HEAD. Use Authenticated request test for POST, PUT, PATCH or DELETE.'
            ))
          ELSE item.value
        END
        ORDER BY item.ord
      ),
      '[]'::jsonb
    )
    INTO fields
    FROM jsonb_array_elements(output #> '{props,fields}') WITH ORDINALITY AS item(value, ord)
    WHERE item.value ->> 'key' NOT IN (
      'provider_extensions',
      'raw_body_required',
      'auth_public_key_ref'
    );

    output := jsonb_set(output, '{props,fields}', fields, true);
  END IF;

  IF output ->> 'type' = 'ContractActionPanel'
     AND output #>> '{props,title}' = 'Endpoint health check'
  THEN
    output := jsonb_set(
      output,
      '{props,subtitle}',
      to_jsonb('Check endpoint reachability with a non-mutating GET or HEAD probe. This does not send stored credentials.'::text),
      true
    );
  END IF;

  RETURN output;
END
$$;

UPDATE eip_core.ui_surface
SET tree = pg_temp.close_connection_operator_fields(tree),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0062"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_connections';

-- Extend the existing persistence scrub so dead legacy configuration cannot be
-- reintroduced by older clients. oauth2_jwt remains retired for inbound auth;
-- raw_body_required is redundant because the canonical public gateway always
-- preserves raw bytes for verification/idempotency; public_key_ref has no V2
-- outbound runtime consumer.
CREATE OR REPLACE FUNCTION tenant.connection_profile_strip_deprecated_inbound_auth()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  probe_method text;
BEGIN
  IF NEW.setting_key LIKE 'connection.profile.%' THEN
    NEW.setting_value := COALESCE(NEW.setting_value, '{}'::jsonb)
      #- '{verification,oauth2_jwt}'
      #- '{inbound,raw_body_required}'
      #- '{outbound,auth,public_key_ref}';

    probe_method := upper(COALESCE(NEW.setting_value #>> '{outbound,test_request_method}', ''));
    IF probe_method <> '' AND probe_method NOT IN ('GET', 'HEAD') THEN
      NEW.setting_value := jsonb_set(
        NEW.setting_value,
        '{outbound,test_request_method}',
        '"HEAD"'::jsonb,
        true
      );
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Normalize existing non-deprecated profiles tenant-by-tenant under the same
-- FORCE-RLS context used by application writes. Empty probe methods remain
-- empty for inbound-only drafts; outbound operators receive HEAD as the UI
-- default on the next save.
DO $$
DECLARE
  tenant_row record;
BEGIN
  FOR tenant_row IN
    SELECT tenant_id
    FROM kernel.tenants
    ORDER BY tenant_id
  LOOP
    PERFORM set_config('app.current_tenant_id', tenant_row.tenant_id::text, true);

    UPDATE tenant.tenant_settings
    SET setting_value =
          CASE
            WHEN upper(COALESCE(setting_value #>> '{outbound,test_request_method}', '')) NOT IN ('', 'GET', 'HEAD')
              THEN jsonb_set(
                setting_value
                  #- '{verification,oauth2_jwt}'
                  #- '{inbound,raw_body_required}'
                  #- '{outbound,auth,public_key_ref}',
                '{outbound,test_request_method}',
                '"HEAD"'::jsonb,
                true
              )
            ELSE setting_value
                  #- '{verification,oauth2_jwt}'
                  #- '{inbound,raw_body_required}'
                  #- '{outbound,auth,public_key_ref}'
          END,
        updated_at = now()
    WHERE tenant_id = tenant_row.tenant_id
      AND setting_key LIKE 'connection.profile.%'
      AND setting_status <> 'deprecated'
      AND (
        setting_value #> '{verification,oauth2_jwt}' IS NOT NULL
        OR setting_value #> '{inbound,raw_body_required}' IS NOT NULL
        OR setting_value #> '{outbound,auth,public_key_ref}' IS NOT NULL
        OR upper(COALESCE(setting_value #>> '{outbound,test_request_method}', '')) NOT IN ('', 'GET', 'HEAD')
      );
  END LOOP;
END
$$;

DO $$
DECLARE
  surface_tree jsonb;
  tenant_row record;
  unsafe_count integer;
BEGIN
  SELECT tree
  INTO surface_tree
  FROM eip_core.ui_surface
  WHERE tenant_id IS NULL
    AND version = 1
    AND code = 'owner_connections'
  LIMIT 1;

  IF surface_tree IS NULL
     OR surface_tree #>> '{props,composition}' <> 'connection_setup_v2'
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "provider_extensions")')
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "raw_body_required")')
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "auth_public_key_ref")')
     OR NOT jsonb_path_exists(
       surface_tree,
       '$.** ? (@.key == "test_request_method" && @.default_value == "HEAD")'
     )
     OR surface_tree::text LIKE '%"path":"attrs"%'
     OR surface_tree::text LIKE '%"path": "attrs"%'
     OR surface_tree::text LIKE '%"tenant_id"%'
  THEN
    RAISE EXCEPTION 'v2_0062 Connections operator surface closure validation failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'tenant.tenant_settings'::regclass
      AND tgname = 'trg_connection_profile_strip_deprecated_inbound_auth'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'v2_0062 requires the Connection profile persistence scrub trigger';
  END IF;

  FOR tenant_row IN
    SELECT tenant_id
    FROM kernel.tenants
    ORDER BY tenant_id
  LOOP
    PERFORM set_config('app.current_tenant_id', tenant_row.tenant_id::text, true);

    SELECT count(*)::int
    INTO unsafe_count
    FROM tenant.tenant_settings
    WHERE tenant_id = tenant_row.tenant_id
      AND setting_key LIKE 'connection.profile.%'
      AND setting_status <> 'deprecated'
      AND (
        setting_value #> '{verification,oauth2_jwt}' IS NOT NULL
        OR setting_value #> '{inbound,raw_body_required}' IS NOT NULL
        OR setting_value #> '{outbound,auth,public_key_ref}' IS NOT NULL
        OR upper(COALESCE(setting_value #>> '{outbound,test_request_method}', '')) NOT IN ('', 'GET', 'HEAD')
      );

    IF unsafe_count <> 0 THEN
      RAISE EXCEPTION 'v2_0062 left % stale/unsafe Connection profile values in tenant %', unsafe_count, tenant_row.tenant_id;
    END IF;
  END LOOP;
END
$$;

COMMIT;
