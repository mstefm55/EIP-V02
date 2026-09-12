BEGIN;

-- v2_0069 used the semantic name "Stack" for single-column groups. The V2 UI
-- registry intentionally exposes only generic registered primitives; normalize
-- those groups to SplitLayout before this branch is released.

CREATE OR REPLACE FUNCTION pg_temp.owner_admin_registered_primitives(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  kind text;
  object_key text;
  object_value jsonb;
  output jsonb;
BEGIN
  IF node IS NULL THEN
    RETURN node;
  END IF;

  kind := jsonb_typeof(node);
  IF kind = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(pg_temp.owner_admin_registered_primitives(item.value) ORDER BY item.ord),
      '[]'::jsonb
    )
    INTO output
    FROM jsonb_array_elements(node) WITH ORDINALITY AS item(value, ord);
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
      pg_temp.owner_admin_registered_primitives(object_value)
    );
  END LOOP;

  IF output ->> 'type' = 'Stack' THEN
    output := jsonb_set(output, '{type}', '"SplitLayout"'::jsonb, true);
    output := jsonb_set(
      output,
      '{props}',
      COALESCE(output -> 'props', '{}'::jsonb)
        || '{"columns":1,"min_column_width":"280px"}'::jsonb,
      true
    );
  END IF;

  RETURN output;
END
$$;

UPDATE eip_core.ui_surface
SET tree = pg_temp.owner_admin_registered_primitives(tree),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0070"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code IN (
    'owner_tenant_requests',
    'owner_users_roles',
    'owner_security',
    'owner_settings',
    'owner_audit',
    'owner_data_explorer'
  );

DO $$
DECLARE
  unsupported_count integer;
BEGIN
  SELECT count(*)::int
  INTO unsupported_count
  FROM eip_core.ui_surface AS surface
  CROSS JOIN LATERAL jsonb_path_query(surface.tree, '$.**.type') AS node_type
  WHERE surface.tenant_id IS NULL
    AND surface.version = 1
    AND surface.code IN (
      'owner_tenant_requests',
      'owner_users_roles',
      'owner_security',
      'owner_settings',
      'owner_audit',
      'owner_data_explorer'
    )
    AND trim(both '"' from node_type::text) NOT IN (
      'SurfaceRoot',
      'PanelHeader',
      'SplitLayout',
      'Tabs',
      'ContractTablePanel',
      'ContractSelectPanel',
      'ContractRecordEditor',
      'ContractDetailEditor',
      'ContractMetricGrid',
      'ContractFlowStepEditor',
      'ContractActionPanel',
      'NoticePanel',
      'SelectionDetailPanel',
      'FlowStepNavigator',
      'FlowStepPanel'
    );

  IF unsupported_count <> 0 THEN
    RAISE EXCEPTION 'v2_0070 Owner Admin surface contains % unsupported primitive declarations', unsupported_count;
  END IF;
END
$$;

COMMIT;
