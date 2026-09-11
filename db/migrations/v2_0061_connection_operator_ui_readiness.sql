BEGIN;

-- EIP Core V2 — Connections operator UI readiness closure.
--
-- This is a forward-only metadata repair for the already executable Connections
-- runtime. It removes duplicate/stale Security inputs left by earlier parity
-- waves and exposes the existing governed request-plan/execute contracts in the
-- Test & Health step. No new table, provider-specific React component, browser
-- tenant authority, or credential persistence path is introduced.

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
    RAISE EXCEPTION 'v2_0061 requires owner_connections connection_setup_v2; found %', composition;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.connection_operator_ui_ready(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  kind text;
  object_key text;
  object_value jsonb;
  output jsonb;
  fields jsonb;
  actions jsonb;
  children jsonb;
  action_ids text[];
BEGIN
  IF node IS NULL THEN
    RETURN node;
  END IF;

  kind := jsonb_typeof(node);

  IF kind = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(pg_temp.connection_operator_ui_ready(items.value) ORDER BY items.ord),
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
      pg_temp.connection_operator_ui_ready(object_value)
    );
  END LOOP;

  -- Security: v2_0046 and v2_0059 used different field keys for several of the
  -- same runtime paths. Keep the v2_0059 capability fields and remove the older
  -- duplicates. auth_public_key_ref is also removed because no live outbound
  -- runtime consumes it.
  IF output ->> 'type' = 'ContractFlowStepEditor'
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements(COALESCE(output #> '{props,fields}', '[]'::jsonb)) AS item(value)
       WHERE item.value ->> 'key' = 'verification_mode'
     )
  THEN
    SELECT COALESCE(jsonb_agg(item.value ORDER BY item.ord), '[]'::jsonb)
    INTO fields
    FROM jsonb_array_elements(COALESCE(output #> '{props,fields}', '[]'::jsonb))
      WITH ORDINALITY AS item(value, ord)
    WHERE item.value ->> 'key' NOT IN (
      'auth_header_name',
      'auth_query_param_name',
      'auth_public_key_ref',
      'auth_username',
      'auth_client_id',
      'auth_client_method',
      'auth_token_url',
      'auth_scope'
    );

    output := jsonb_set(output, '{props,fields}', fields, true);
  END IF;

  -- Rename the original network-only probe so operators do not confuse simple
  -- endpoint reachability with an authenticated provider request.
  IF output ->> 'type' = 'ContractActionPanel' THEN
    SELECT COALESCE(array_agg(action.value ->> 'id'), ARRAY[]::text[])
    INTO action_ids
    FROM jsonb_array_elements(COALESCE(output #> '{props,actions}', '[]'::jsonb)) AS action(value);

    IF 'test' = ANY(action_ids) THEN
      output := jsonb_set(output, '{props,title}', to_jsonb('Endpoint health check'::text), true);
      output := jsonb_set(
        output,
        '{props,subtitle}',
        to_jsonb('Check network reachability to the configured outbound endpoint.'::text),
        true
      );

      SELECT COALESCE(
        jsonb_agg(
          CASE
            WHEN action.value ->> 'id' = 'test' THEN
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    action.value,
                    '{label}',
                    to_jsonb('Check endpoint'::text),
                    true
                  ),
                  '{success_message}',
                  to_jsonb('Endpoint check completed.'::text),
                  true
                ),
                '{result_fields}',
                '[{"path":"result.ok","label":"Reachable"},{"path":"result.status_code","label":"HTTP status"},{"path":"result.latency_ms","label":"Latency (ms)"},{"path":"result.tested_at","label":"Tested at"}]'::jsonb,
                true
              )
            ELSE action.value
          END
          ORDER BY action.ord
        ),
        '[]'::jsonb
      )
      INTO actions
      FROM jsonb_array_elements(COALESCE(output #> '{props,actions}', '[]'::jsonb))
        WITH ORDINALITY AS action(value, ord);

      output := jsonb_set(output, '{props,actions}', actions, true);
    END IF;

    -- Replace the narrow inbound-only readiness button with the existing full
    -- readiness projection so activation, inbound and outbound state are visible
    -- before the operator enables or exercises the connection.
    IF 'inbound_readiness' = ANY(action_ids) THEN
      output := jsonb_set(output, '{props,title}', to_jsonb('Connection readiness'::text), true);
      output := jsonb_set(
        output,
        '{props,subtitle}',
        to_jsonb('Review activation, inbound and outbound readiness.'::text),
        true
      );
      output := jsonb_set(
        output,
        '{props,actions}',
        $actions$
        [
          {
            "id":"connection_readiness",
            "label":"Check readiness",
            "contract":{
              "method":"GET",
              "endpoint":"/api/eip/owner-admin/connections/tenants/:tenant_code/:code/readiness",
              "path_params":{"tenant_code":"$selections.connection_tenant.code"}
            },
            "permissions_any":["OWNER_ADMIN_CONNECTION_READ"],
            "success_message":"Readiness checked.",
            "result_fields":[
              {"path":"readiness.activation.ready","label":"Activation ready"},
              {"path":"readiness.activation.required_secret_kinds","label":"Required credentials"},
              {"path":"readiness.inbound.runtime_status","label":"Inbound"},
              {"path":"readiness.outbound.runtime_status","label":"Outbound"}
            ]
          }
        ]
        $actions$::jsonb,
        true
      );
      output := jsonb_set(
        output,
        '{props,permissions_any}',
        '["OWNER_ADMIN_CONNECTION_READ"]'::jsonb,
        true
      );
    END IF;

    IF output #>> '{props,title}' = 'Inbound endpoint' THEN
      output := jsonb_set(
        output,
        '{props,subtitle}',
        to_jsonb('Show the live inbound endpoint for this connection.'::text),
        true
      );
    END IF;
  END IF;

  -- Test & Health: expose the already governed request planner and executable
  -- outbound runtime through one provider-neutral ContractActionPanel. Preview
  -- works before activation; live execution stays protected by the existing API
  -- rule that the connection must be enabled.
  IF output ->> 'type' = 'FlowStepPanel'
     AND output #>> '{props,step_id}' = 'health'
  THEN
    children := COALESCE(output -> 'children', '[]'::jsonb);

    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(children) AS child(value)
      WHERE child.value #>> '{props,title}' = 'Authenticated request test'
    ) THEN
      children := children || $panel$
      [
        {
          "type":"ContractActionPanel",
          "props":{
            "record_selection_target":"connection",
            "record_key":"connection_code",
            "record_path_param":"code",
            "permissions_any":["OWNER_ADMIN_CONNECTION_TEST"],
            "title":"Authenticated request test",
            "subtitle":"Preview a request or send it through the configured authentication. Sending requires the connection to be enabled.",
            "fields":[
              {
                "key":"method",
                "path":"method",
                "label":"Method",
                "type":"select",
                "required":true,
                "default_value":"GET",
                "options":[
                  {"value":"GET","label":"GET"},
                  {"value":"POST","label":"POST"},
                  {"value":"PUT","label":"PUT"},
                  {"value":"PATCH","label":"PATCH"},
                  {"value":"DELETE","label":"DELETE"},
                  {"value":"HEAD","label":"HEAD"},
                  {"value":"OPTIONS","label":"OPTIONS"}
                ]
              },
              {
                "key":"path",
                "path":"path",
                "label":"Relative path",
                "placeholder":"/v1/status",
                "omit_empty":true
              },
              {
                "key":"response_encoding",
                "path":"response_encoding",
                "label":"Response format",
                "type":"select",
                "default_value":"auto",
                "options":[
                  {"value":"auto","label":"Automatic"},
                  {"value":"json","label":"JSON"},
                  {"value":"text","label":"Text"},
                  {"value":"base64","label":"Binary (Base64)"}
                ]
              },
              {
                "key":"idempotency_key",
                "path":"idempotency_key",
                "label":"Idempotency key",
                "omit_empty":true
              }
            ],
            "actions":[
              {
                "id":"preview_authenticated_request",
                "label":"Preview request",
                "contract":{
                  "method":"POST",
                  "endpoint":"/api/eip/owner-admin/connections/tenants/:tenant_code/:code/request-plan",
                  "path_params":{"tenant_code":"$selections.connection_tenant.code"}
                },
                "payload":{
                  "method":"$draft.method",
                  "path":"$draft.path",
                  "body_encoding":"none",
                  "response_encoding":"$draft.response_encoding",
                  "idempotency_key":"$draft.idempotency_key"
                },
                "permissions_any":["OWNER_ADMIN_CONNECTION_TEST"],
                "success_message":"Request preview ready.",
                "result_fields":[
                  {"path":"result.plan.method","label":"Method"},
                  {"path":"result.plan.url","label":"URL","copyable":true},
                  {"path":"result.plan.authentication.mode","label":"Authentication"},
                  {"path":"result.plan.authentication.credential_kind_required","label":"Required credential"},
                  {"path":"result.plan.timeout_ms","label":"Timeout (ms)"},
                  {"path":"result.plan.max_retries","label":"Max retries"}
                ]
              },
              {
                "id":"execute_authenticated_request",
                "label":"Send test request",
                "confirm_message":"Send this request to the configured external provider?",
                "contract":{
                  "method":"POST",
                  "endpoint":"/api/eip/owner-admin/connections/tenants/:tenant_code/:code/execute",
                  "path_params":{"tenant_code":"$selections.connection_tenant.code"}
                },
                "payload":{
                  "method":"$draft.method",
                  "path":"$draft.path",
                  "body_encoding":"none",
                  "response_encoding":"$draft.response_encoding",
                  "idempotency_key":"$draft.idempotency_key"
                },
                "permissions_any":["OWNER_ADMIN_CONNECTION_TEST"],
                "success_message":"Test request completed.",
                "result_fields":[
                  {"path":"result.ok","label":"Successful"},
                  {"path":"result.status_code","label":"HTTP status"},
                  {"path":"result.latency_ms","label":"Latency (ms)"},
                  {"path":"result.attempts","label":"Attempts"},
                  {"path":"result.body","label":"Response"}
                ]
              }
            ]
          }
        }
      ]
      $panel$::jsonb;

      output := jsonb_set(output, '{children}', children, true);
    END IF;
  END IF;

  RETURN output;
END
$$;

UPDATE eip_core.ui_surface
SET tree = pg_temp.connection_operator_ui_ready(tree),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0061"'::jsonb, true),
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
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "auth_header_name")')
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "auth_query_param_name")')
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "auth_public_key_ref")')
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "auth_username")')
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "auth_client_id")')
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "auth_client_method")')
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "auth_token_url")')
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "auth_scope")')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.key == "outbound_api_key_header")')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.key == "outbound_api_key_query")')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.key == "outbound_username")')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.key == "oauth_client_id")')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.key == "oauth_client_auth_method")')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.key == "oauth_token_url")')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.key == "oauth_scope")')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.id == "connection_readiness")')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.id == "preview_authenticated_request")')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.id == "execute_authenticated_request")')
     OR surface_tree::text NOT LIKE '%/connections/tenants/:tenant_code/:code/request-plan%'
     OR surface_tree::text NOT LIKE '%/connections/tenants/:tenant_code/:code/execute%'
     OR surface_tree::text NOT LIKE '%/connections/tenants/:tenant_code/:code/readiness%'
     OR surface_tree::text LIKE '%"tenant_id"%'
  THEN
    RAISE EXCEPTION 'v2_0061 Connections operator UI readiness validation failed';
  END IF;
END
$$;

COMMIT;
