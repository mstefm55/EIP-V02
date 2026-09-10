BEGIN;

-- EIP Core V2 — Connection creation parity with the accepted V1 Owner Admin UX.
--
-- V1 does not ask the operator to invent a connection code. The code is
-- generated from the connection name and receives a numeric suffix when the
-- prefix already exists. V2 keeps that allocation server-authoritative while
-- the metadata-driven UI presents the code as read-only and keeps activation
-- disabled until the draft has been created and configured.

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
    RAISE EXCEPTION 'v2_0055 requires owner_connections connection_setup_v2; found %', composition;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.rewrite_connection_create_parity(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  kind text;
  current_key text;
  current_value jsonb;
  output jsonb;
  rewritten_fields jsonb;
BEGIN
  IF node IS NULL THEN
    RETURN node;
  END IF;

  kind := jsonb_typeof(node);

  IF kind = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(
        pg_temp.rewrite_connection_create_parity(items.item_value)
        ORDER BY items.ord
      ),
      '[]'::jsonb
    )
    INTO output
    FROM jsonb_array_elements(node) WITH ORDINALITY AS items(item_value, ord);
    RETURN output;
  END IF;

  IF kind <> 'object' THEN
    RETURN node;
  END IF;

  output := '{}'::jsonb;
  FOR current_key, current_value IN
    SELECT pairs.pair_key, pairs.pair_value
    FROM jsonb_each(node) AS pairs(pair_key, pair_value)
  LOOP
    output := output || jsonb_build_object(
      current_key,
      pg_temp.rewrite_connection_create_parity(current_value)
    );
  END LOOP;

  IF output ->> 'type' = 'ContractFlowStepEditor'
     AND output #>> '{props,record_selection_target}' = 'connection'
     AND output #>> '{props,create_when_unselected}' = 'true'
     AND output #>> '{props,create_contract,method}' = 'POST'
  THEN
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN fields.field ->> 'key' = 'connection_code' THEN
            fields.field || jsonb_build_object(
              'required', false,
              'read_only', true,
              'omit_empty', true,
              'immutable_after_create', true,
              'placeholder', 'auto-generated',
              'help', 'Generated automatically from the connection-name prefix. If that code already exists for the selected tenant, the next numeric suffix is used (-2, -3, ...).'
            )
          WHEN fields.field ->> 'key' = 'is_enabled' THEN
            fields.field || jsonb_build_object(
              'default_value', false,
              'disabled_on_create', true,
              'help', 'New connections are always created disabled. Complete setup and readiness checks before enabling.'
            )
          ELSE fields.field
        END
        ORDER BY fields.ord
      ),
      '[]'::jsonb
    )
    INTO rewritten_fields
    FROM jsonb_array_elements(
      COALESCE(output #> '{props,fields}', '[]'::jsonb)
    ) WITH ORDINALITY AS fields(field, ord);

    output := jsonb_set(output, '{props,fields}', rewritten_fields, true);
    output := jsonb_set(
      output,
      '{props,new_record_template,identity,is_enabled}',
      'false'::jsonb,
      true
    );
    output := jsonb_set(
      output,
      '{props,create_mode_message}',
      to_jsonb('Create a disabled identity draft. The connection code is generated automatically from the connection name using the V1 prefix-and-serial convention.'::text),
      true
    );
  END IF;

  RETURN output;
END
$$;

UPDATE eip_core.ui_surface
SET tree = pg_temp.rewrite_connection_create_parity(tree),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0055"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_connections';

DO $$
DECLARE
  surface_tree jsonb;
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
     OR NOT jsonb_path_exists(
       surface_tree,
       '$.** ? (@.key == "connection_code" && @.read_only == true && @.omit_empty == true && @.immutable_after_create == true)'
     )
     OR NOT jsonb_path_exists(
       surface_tree,
       '$.** ? (@.key == "is_enabled" && @.disabled_on_create == true && @.default_value == false)'
     )
     OR surface_tree::text NOT LIKE '%auto-generated%'
     OR surface_tree::text NOT LIKE '%prefix-and-serial%'
     OR surface_tree::text LIKE '%"tenant_id"%'
  THEN
    RAISE EXCEPTION 'v2_0055 connection create-code parity validation failed';
  END IF;
END
$$;

COMMIT;
