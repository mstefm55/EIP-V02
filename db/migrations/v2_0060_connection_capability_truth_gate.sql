BEGIN;

-- Keep the Connections control plane truthful: every selectable verification
-- mode must have a live verifier. OAuth2/JWT was inherited as taxonomy/config
-- metadata but has no inbound runtime verifier in this release, so it must not
-- remain selectable. Provider Signature now covers the implemented Stripe and
-- PayPal webhook-verification adapters.

UPDATE eip_core.dropdown_value dv
SET is_active = false,
    updated_at = now()
FROM eip_core.dropdown_list dl
WHERE dl.id = dv.list_id
  AND dl.tenant_id IS NULL
  AND dl.module = 'integration'
  AND dl.code = 'CONNECTION_VERIFICATION_MODE'
  AND dl.version = 1
  AND dv.code = 'oauth2_jwt';

CREATE OR REPLACE FUNCTION pg_temp.remove_connection_field(node jsonb, field_key text)
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
      jsonb_agg(pg_temp.remove_connection_field(items.value, field_key) ORDER BY items.ord),
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
      pg_temp.remove_connection_field(object_value, field_key)
    );
  END LOOP;

  IF output ->> 'type' = 'ContractFlowStepEditor'
     AND jsonb_typeof(output #> '{props,fields}') = 'array'
  THEN
    SELECT COALESCE(jsonb_agg(item.value ORDER BY item.ord), '[]'::jsonb)
    INTO fields
    FROM jsonb_array_elements(output #> '{props,fields}') WITH ORDINALITY AS item(value, ord)
    WHERE item.value ->> 'key' <> field_key;
    output := jsonb_set(output, '{props,fields}', fields, true);
  END IF;

  RETURN output;
END
$$;

UPDATE eip_core.ui_surface
SET tree = pg_temp.remove_connection_field(tree, 'jwt_config'),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0060"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_connections';

DO $$
DECLARE
  surface_tree jsonb;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM eip_core.dropdown_list dl
    JOIN eip_core.dropdown_value dv ON dv.list_id = dl.id
    WHERE dl.tenant_id IS NULL
      AND dl.module = 'integration'
      AND dl.code = 'CONNECTION_VERIFICATION_MODE'
      AND dl.version = 1
      AND dl.is_active = true
      AND dv.code = 'oauth2_jwt'
      AND dv.is_active = true
  ) THEN
    RAISE EXCEPTION 'v2_0060 left an unimplemented oauth2_jwt inbound verifier selectable';
  END IF;

  SELECT tree
  INTO surface_tree
  FROM eip_core.ui_surface
  WHERE tenant_id IS NULL
    AND version = 1
    AND code = 'owner_connections'
  LIMIT 1;

  IF surface_tree IS NULL
     OR surface_tree #>> '{props,composition}' <> 'connection_setup_v2'
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "jwt_config")')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.key == "provider_verifier" && @.advanced == true)')
  THEN
    RAISE EXCEPTION 'v2_0060 Connections capability truth validation failed';
  END IF;
END
$$;

COMMIT;
