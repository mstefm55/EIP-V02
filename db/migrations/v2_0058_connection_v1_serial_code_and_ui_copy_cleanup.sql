BEGIN;

-- Connections creation correction:
-- - the human Connection name is independent from the system Connection code;
-- - new Connection codes are allocated by the API with the V1 `conn-<serial>` pattern;
-- - the code is not shown until the draft exists;
-- - implementation/security commentary is removed from the production surface.

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
    RAISE EXCEPTION 'v2_0058 requires owner_connections connection_setup_v2; found %', composition;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.clean_connection_surface(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  node_kind text;
  object_key text;
  object_value jsonb;
  output jsonb;
  rewritten_fields jsonb;
  node_id text;
  step_id text;
BEGIN
  IF node IS NULL THEN
    RETURN node;
  END IF;

  node_kind := jsonb_typeof(node);

  IF node_kind = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(pg_temp.clean_connection_surface(items.item_value) ORDER BY items.ord),
      '[]'::jsonb
    )
    INTO output
    FROM jsonb_array_elements(node) WITH ORDINALITY AS items(item_value, ord);
    RETURN output;
  END IF;

  IF node_kind <> 'object' THEN
    RETURN node;
  END IF;

  output := '{}'::jsonb;
  FOR object_key, object_value IN
    SELECT pairs.pair_key, pairs.pair_value
    FROM jsonb_each(node) AS pairs(pair_key, pair_value)
  LOOP
    output := output || jsonb_build_object(
      object_key,
      pg_temp.clean_connection_surface(object_value)
    );
  END LOOP;

  node_id := output ->> 'id';
  step_id := output #>> '{props,step_id}';

  IF node_id = 'owner_connections_header' THEN
    output := jsonb_set(output, '{props,subtitle}', to_jsonb('Create and manage connections for each tenant.'::text), true);
  END IF;

  IF output ->> 'type' = 'ContractSelectPanel'
     AND output #>> '{props,selection_target}' = 'connection_tenant'
  THEN
    output := jsonb_set(output, '{props,subtitle}', to_jsonb('Choose a tenant.'::text), true);
    output := jsonb_set(output, '{props,field_label}', to_jsonb('Tenant'::text), true);
  END IF;

  IF output ->> 'type' = 'FlowStepPanel' THEN
    CASE step_id
      WHEN 'identity' THEN
        output := jsonb_set(output, '{props,subtitle}', to_jsonb('Connection details.'::text), true);
      WHEN 'endpoint' THEN
        output := jsonb_set(output, '{props,subtitle}', to_jsonb('Direction and endpoints.'::text), true);
      WHEN 'security' THEN
        output := jsonb_set(output, '{props,subtitle}', to_jsonb('Authentication and credentials.'::text), true);
      WHEN 'reliability' THEN
        output := jsonb_set(output, '{props,subtitle}', to_jsonb('Retry, timeout and duplicate handling.'::text), true);
      WHEN 'routing' THEN
        output := jsonb_set(output, '{props,subtitle}', to_jsonb('Routing and data mapping.'::text), true);
      WHEN 'health' THEN
        output := jsonb_set(output, '{props,subtitle}', to_jsonb('Test the connection and review its status.'::text), true);
      WHEN 'audit' THEN
        output := jsonb_set(output, '{props,subtitle}', to_jsonb('Logging and audit settings.'::text), true);
      ELSE
        NULL;
    END CASE;
  END IF;

  IF output ->> 'type' = 'ContractFlowStepEditor'
     AND output #>> '{props,record_selection_target}' = 'connection'
     AND output #>> '{props,create_when_unselected}' = 'true'
     AND output #>> '{props,create_contract,method}' = 'POST'
  THEN
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN fields.field ->> 'key' = 'connection_code' THEN
            (fields.field - 'create_preview' - 'help') || jsonb_build_object(
              'required', false,
              'read_only', true,
              'omit_empty', true,
              'immutable_after_create', true,
              'hide_on_create', true,
              'placeholder', 'Assigned automatically'
            )
          WHEN fields.field ->> 'key' = 'is_enabled' THEN
            fields.field - 'help'
          ELSE fields.field
        END
        ORDER BY fields.ord
      ),
      '[]'::jsonb
    )
    INTO rewritten_fields
    FROM jsonb_array_elements(COALESCE(output #> '{props,fields}', '[]'::jsonb))
      WITH ORDINALITY AS fields(field, ord);

    output := jsonb_set(output, '{props,fields}', rewritten_fields, true);
    output := jsonb_set(output, '{props,new_record_template,identity,is_enabled}', 'false'::jsonb, true);
    output := jsonb_set(output, '{props,create_mode_title}', to_jsonb('New connection'::text), true);
    output := output #- '{props,create_mode_message}';
  END IF;

  RETURN output;
END
$$;

UPDATE eip_core.ui_surface
SET tree = pg_temp.clean_connection_surface(tree),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0058"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_connections';

DO $$
DECLARE
  surface_tree jsonb;
  surface_text text;
BEGIN
  SELECT tree, tree::text
  INTO surface_tree, surface_text
  FROM eip_core.ui_surface
  WHERE tenant_id IS NULL
    AND version = 1
    AND code = 'owner_connections'
  LIMIT 1;

  IF surface_tree IS NULL
     OR surface_tree #>> '{props,composition}' <> 'connection_setup_v2'
     OR NOT jsonb_path_exists(
       surface_tree,
       '$.** ? (@.key == "connection_code" && @.read_only == true && @.immutable_after_create == true && @.hide_on_create == true)'
     )
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "connection_code" && exists(@.create_preview))')
     OR surface_text LIKE '%V1 naming protocol%'
     OR surface_text LIKE '%server allocates%'
     OR surface_text LIKE '%server-authorized%'
     OR surface_text LIKE '%tenant-scoped%'
     OR surface_text LIKE '%control plane%'
     OR surface_text LIKE '%write-only credentials%'
     OR surface_text LIKE '%server-side probe%'
     OR surface_text LIKE '%governed auth%'
  THEN
    RAISE EXCEPTION 'v2_0058 Connections serial-code/UI-copy validation failed';
  END IF;
END
$$;

COMMIT;
