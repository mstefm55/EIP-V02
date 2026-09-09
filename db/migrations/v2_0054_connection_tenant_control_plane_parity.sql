BEGIN;

-- EIP Core V2 — Owner Admin Connections tenant control-plane parity.
--
-- V1 Owner Admin selected the tenant whose connection control plane was being
-- administered. v2_0046 incorrectly collapsed that scope to the authenticated
-- organisation only. This forward repair restores an explicit target-tenant
-- selector while keeping authority server-side:
--   * the browser selects only a tenant code from a server-provided allow-list;
--   * every target route re-resolves that code against kernel.tenants;
--   * tenant_id remains forbidden in browser-controlled headers/query/body;
--   * all tenant-owned reads/writes still bind through server-side tenant scope.

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
    RAISE EXCEPTION 'v2_0054 requires owner_connections connection_setup_v2; found %', composition;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.rewrite_connection_tenant_contracts(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  kind text;
  key text;
  value jsonb;
  output jsonb;
  endpoint text;
  rewritten_endpoint text;
BEGIN
  IF node IS NULL THEN
    RETURN node;
  END IF;

  kind := jsonb_typeof(node);

  IF kind = 'array' THEN
    SELECT COALESCE(jsonb_agg(pg_temp.rewrite_connection_tenant_contracts(value) ORDER BY ord), '[]'::jsonb)
    INTO output
    FROM jsonb_array_elements(node) WITH ORDINALITY AS items(value, ord);
    RETURN output;
  END IF;

  IF kind <> 'object' THEN
    RETURN node;
  END IF;

  output := '{}'::jsonb;
  FOR key, value IN SELECT * FROM jsonb_each(node)
  LOOP
    output := output || jsonb_build_object(key, pg_temp.rewrite_connection_tenant_contracts(value));
  END LOOP;

  endpoint := output ->> 'endpoint';
  rewritten_endpoint := NULL;

  IF endpoint = '/api/eip/owner-admin/connections' THEN
    rewritten_endpoint := '/api/eip/owner-admin/connections/tenants/:tenant_code';
  ELSIF endpoint LIKE '/api/eip/owner-admin/connections/:code%' THEN
    rewritten_endpoint := replace(
      endpoint,
      '/api/eip/owner-admin/connections/:code',
      '/api/eip/owner-admin/connections/tenants/:tenant_code/:code'
    );
  END IF;

  IF rewritten_endpoint IS NOT NULL THEN
    output := jsonb_set(output, '{endpoint}', to_jsonb(rewritten_endpoint), true);
    output := jsonb_set(
      output,
      '{path_params}',
      COALESCE(output -> 'path_params', '{}'::jsonb)
        || jsonb_build_object('tenant_code', '$selections.connection_tenant.code'),
      true
    );
  END IF;

  IF output ->> 'type' = 'ContractTablePanel'
     AND output #>> '{props,selection,target}' = 'connection' THEN
    output := jsonb_set(
      output,
      '{props,selection,new_action,select_target}',
      '"connection_setup_step"'::jsonb,
      true
    );
    output := jsonb_set(
      output,
      '{props,selection,new_action,select_value}',
      '{"id":"identity","step_id":"identity","label":"Identity"}'::jsonb,
      true
    );
  END IF;

  RETURN output;
END
$$;

UPDATE eip_core.ui_surface
SET tree = pg_temp.rewrite_connection_tenant_contracts(tree),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_connections';

-- Put tenant scope ahead of the connection catalogue/setup workspace. The
-- selector is generic metadata: it receives only active tenant DTOs from the
-- guarded Owner Admin contract and stores the selected DTO as UI state.
UPDATE eip_core.ui_surface
SET tree = jsonb_insert(
      tree,
      '{children,1}',
      $json$
      {
        "type":"ContractSelectPanel",
        "props":{
          "eyebrow":"Owner Admin scope",
          "title":"Tenant",
          "field_label":"Manage connections for tenant",
          "subtitle":"Choose the tenant whose connection control plane you want to administer. Access remains enforced by the server.",
          "selection_target":"connection_tenant",
          "value_key":"code",
          "label_key":"name",
          "secondary_key":"code",
          "items_path":"items",
          "auto_select_first":true,
          "default_to_authenticated_tenant":true,
          "clear_targets_on_change":["connection"],
          "select_targets_on_change":{
            "connection_setup_step":{"id":"identity","step_id":"identity","label":"Identity"}
          },
          "options_contract":{
            "method":"GET",
            "endpoint":"/api/eip/owner-admin/connections/tenants"
          },
          "loading_title":"Loading tenants...",
          "empty_message":"No active tenants are available for connection administration.",
          "error_title":"Tenant scope unavailable",
          "refresh_label":"Refresh tenants"
        }
      }
      $json$::jsonb,
      false
    ),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_connections';

UPDATE eip_core.ui_surface
SET tree = jsonb_set(
      tree,
      '{children,0,props,subtitle}',
      to_jsonb('Manage tenant-specific external gateways. Owner Admin chooses a target tenant, while every connection and credential remains server-authorized and tenant-scoped.'::text),
      true
    ),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0054"'::jsonb, true),
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
     OR surface_tree::text NOT LIKE '%ContractSelectPanel%'
     OR surface_tree::text NOT LIKE '%connection_tenant%'
     OR surface_tree::text NOT LIKE '%/api/eip/owner-admin/connections/tenants/:tenant_code%'
     OR surface_tree::text NOT LIKE '%$selections.connection_tenant.code%'
     OR surface_tree::text NOT LIKE '%connection_setup_step%'
     OR surface_tree::text NOT LIKE '%"step_id": "identity"%'
     OR surface_tree::text LIKE '%"tenant_id"%' THEN
    RAISE EXCEPTION 'v2_0054 tenant-scoped Connections control-plane validation failed';
  END IF;

  IF surface_tree::text LIKE '%/api/eip/owner-admin/connections/:code%' THEN
    RAISE EXCEPTION 'v2_0054 left an unscoped connection detail contract behind';
  END IF;
END
$$;

COMMIT;
