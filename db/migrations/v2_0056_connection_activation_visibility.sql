BEGIN;

-- EIP Core V2 — Connection activation visibility repair.
--
-- Creation and activation are separate lifecycle actions. New connections are
-- always created as disabled drafts; the Enabled control is therefore hidden
-- while the generic step editor is in create mode and becomes visible only
-- after a persisted connection has been selected.

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
    RAISE EXCEPTION 'v2_0056 requires owner_connections connection_setup_v2; found %', composition;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.rewrite_connection_activation_visibility(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  node_kind text;
  object_key text;
  object_value jsonb;
  output jsonb;
  rewritten_fields jsonb;
BEGIN
  IF node IS NULL THEN
    RETURN node;
  END IF;

  node_kind := jsonb_typeof(node);

  IF node_kind = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(
        pg_temp.rewrite_connection_activation_visibility(items.item_value)
        ORDER BY items.ord
      ),
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
      pg_temp.rewrite_connection_activation_visibility(object_value)
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
          WHEN fields.field ->> 'key' = 'is_enabled' THEN
            (fields.field - 'disabled_on_create') || jsonb_build_object(
              'hide_on_create', true,
              'default_value', false,
              'help', 'Activation is available after the disabled draft is created and remains validated by server readiness checks.'
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
  END IF;

  RETURN output;
END
$$;

UPDATE eip_core.ui_surface
SET tree = pg_temp.rewrite_connection_activation_visibility(tree),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0056"'::jsonb, true),
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
       '$.** ? (@.key == "is_enabled" && @.hide_on_create == true && @.default_value == false)'
     )
     OR jsonb_path_exists(
       surface_tree,
       '$.** ? (@.key == "is_enabled" && @.disabled_on_create == true)'
     )
     OR surface_tree::text LIKE '%"tenant_id"%'
  THEN
    RAISE EXCEPTION 'v2_0056 connection activation visibility validation failed';
  END IF;
END
$$;

COMMIT;
