BEGIN;

-- EIP Core V2 — V1 Connection code naming/display parity.
--
-- The authoritative Connection code is still allocated by the server from the
-- Connection name (lower-case URL-safe slug, then -2, -3, ... on tenant-local
-- collision). This migration only teaches the generic metadata-driven editor to
-- preview the same V1 slug transformation while the operator types the name.
-- The preview is read-only and is never submitted as code authority.

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
    RAISE EXCEPTION 'v2_0057 requires owner_connections connection_setup_v2; found %', composition;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.rewrite_connection_code_preview(node jsonb)
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
        pg_temp.rewrite_connection_code_preview(items.item_value)
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
      pg_temp.rewrite_connection_code_preview(object_value)
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
              'create_preview', jsonb_build_object(
                'source_key', 'connection_name',
                'transform', 'slug',
                'fallback', 'conn',
                'min_length', 3,
                'short_suffix', '-conn',
                'max_length', 64
              ),
              'help', 'V1 naming protocol: the system converts the name to a lower-case URL-safe code (for example, My Website -> my-website). If that code already exists for the selected tenant, the server allocates -2, -3, and so on.'
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
      '{props,create_mode_message}',
      to_jsonb('Create a disabled identity draft. Connection code follows the V1 naming protocol: a read-only URL-safe slug is previewed from the name, while the server remains authoritative for the final tenant-unique code and numeric suffix.'::text),
      true
    );
  END IF;

  RETURN output;
END
$$;

UPDATE eip_core.ui_surface
SET tree = pg_temp.rewrite_connection_code_preview(tree),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0057"'::jsonb, true),
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
       '$.** ? (@.key == "connection_code" && @.read_only == true && @.create_preview.source_key == "connection_name" && @.create_preview.transform == "slug" && @.create_preview.fallback == "conn" && @.create_preview.min_length == 3 && @.create_preview.short_suffix == "-conn" && @.create_preview.max_length == 64)'
     )
     OR surface_tree::text NOT LIKE '%V1 naming protocol%'
     OR surface_tree::text LIKE '%"tenant_id"%'
  THEN
    RAISE EXCEPTION 'v2_0057 Connection code preview parity validation failed';
  END IF;
END
$$;

COMMIT;
