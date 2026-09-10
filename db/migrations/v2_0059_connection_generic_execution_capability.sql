BEGIN;

-- EIP Core V2 — generic HTTP execution capability for governed Connections.
-- The seven-step UX is retained. Low-frequency request/auth/provider parameters
-- are added as Advanced metadata fields and persisted through the existing
-- tenant connection profile attrs extension point; no new table is required.

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
    RAISE EXCEPTION 'v2_0059 requires owner_connections connection_setup_v2; found %', composition;
  END IF;
END
$$;

WITH list_defs(module, code, name, attrs) AS (
  VALUES
    ('integration', 'CONNECTION_BODY_ENCODING', 'Connection Body Encoding', '{"ui":{"applies_to":["connection.attrs.outbound_request.body_encoding"]}}'::jsonb),
    ('integration', 'CONNECTION_RESPONSE_ENCODING', 'Connection Response Encoding', '{"ui":{"applies_to":["connection.attrs.outbound_request.response_encoding"]}}'::jsonb),
    ('integration', 'CONNECTION_OAUTH_CLIENT_AUTH_METHOD', 'OAuth Client Authentication Method', '{"ui":{"applies_to":["connection.attrs.oauth_client_credentials.client_auth_method"]}}'::jsonb),
    ('integration', 'CONNECTION_OAUTH_TOKEN_BODY_ENCODING', 'OAuth Token Body Encoding', '{"ui":{"applies_to":["connection.attrs.oauth_client_credentials.token_body_encoding"]}}'::jsonb),
    ('integration', 'CONNECTION_PROVIDER_VERIFIER', 'Connection Provider Verifier', '{"ui":{"applies_to":["connection.attrs.provider_signature.provider_code"]}}'::jsonb)
), upserted AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  SELECT NULL, module, code, name, 1, true, attrs
  FROM list_defs
  ON CONFLICT (tenant_id, module, code, version) DO UPDATE
  SET name = EXCLUDED.name,
      is_active = true,
      attrs = EXCLUDED.attrs,
      updated_at = now()
  RETURNING id, code
)
SELECT count(*) FROM upserted;

WITH value_defs(list_code, code, label, sort_order, attrs) AS (
  VALUES
    ('CONNECTION_BODY_ENCODING', 'none', 'None', 10, '{}'::jsonb),
    ('CONNECTION_BODY_ENCODING', 'json', 'JSON', 20, '{}'::jsonb),
    ('CONNECTION_BODY_ENCODING', 'form', 'Form URL Encoded', 30, '{}'::jsonb),
    ('CONNECTION_BODY_ENCODING', 'text', 'Text', 40, '{}'::jsonb),
    ('CONNECTION_BODY_ENCODING', 'base64', 'Binary (Base64)', 50, '{}'::jsonb),

    ('CONNECTION_RESPONSE_ENCODING', 'auto', 'Automatic', 10, '{}'::jsonb),
    ('CONNECTION_RESPONSE_ENCODING', 'json', 'JSON', 20, '{}'::jsonb),
    ('CONNECTION_RESPONSE_ENCODING', 'text', 'Text', 30, '{}'::jsonb),
    ('CONNECTION_RESPONSE_ENCODING', 'base64', 'Binary (Base64)', 40, '{}'::jsonb),

    ('CONNECTION_OAUTH_CLIENT_AUTH_METHOD', 'basic', 'Basic Header', 10, '{}'::jsonb),
    ('CONNECTION_OAUTH_CLIENT_AUTH_METHOD', 'body', 'Request Body', 20, '{}'::jsonb),

    ('CONNECTION_OAUTH_TOKEN_BODY_ENCODING', 'form', 'Form URL Encoded', 10, '{}'::jsonb),
    ('CONNECTION_OAUTH_TOKEN_BODY_ENCODING', 'json', 'JSON', 20, '{}'::jsonb),

    ('CONNECTION_PROVIDER_VERIFIER', 'stripe', 'Stripe', 10, '{}'::jsonb),
    ('CONNECTION_PROVIDER_VERIFIER', 'paypal', 'PayPal', 20, '{}'::jsonb)
), lists AS (
  SELECT id, code
  FROM eip_core.dropdown_list
  WHERE tenant_id IS NULL
    AND module = 'integration'
    AND version = 1
    AND is_active = true
    AND code IN (
      'CONNECTION_BODY_ENCODING',
      'CONNECTION_RESPONSE_ENCODING',
      'CONNECTION_OAUTH_CLIENT_AUTH_METHOD',
      'CONNECTION_OAUTH_TOKEN_BODY_ENCODING',
      'CONNECTION_PROVIDER_VERIFIER'
    )
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT lists.id, value_defs.code, value_defs.label, value_defs.sort_order, true, value_defs.attrs
FROM value_defs
JOIN lists ON lists.code = value_defs.list_code
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = true,
    attrs = EXCLUDED.attrs,
    updated_at = now();

WITH target_lists AS (
  SELECT id, code
  FROM eip_core.dropdown_list
  WHERE tenant_id IS NULL
    AND module = 'integration'
    AND version = 1
    AND is_active = true
    AND code IN ('CONNECTION_VERIFICATION_MODE', 'CONNECTION_SECRET_KIND')
), additions(list_code, code, label, sort_order, attrs) AS (
  VALUES
    ('CONNECTION_VERIFICATION_MODE', 'provider_signature', 'Provider Signature', 50, '{}'::jsonb),
    ('CONNECTION_SECRET_KIND', 'webhook_signing_secret', 'Webhook Signing Secret', 60, '{"secret":true}'::jsonb)
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT target_lists.id, additions.code, additions.label, additions.sort_order, true, additions.attrs
FROM additions
JOIN target_lists ON target_lists.code = additions.list_code
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = true,
    attrs = EXCLUDED.attrs,
    updated_at = now();

CREATE OR REPLACE FUNCTION pg_temp.connection_field_exists(fields jsonb, field_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(fields, '[]'::jsonb)) AS entry(value)
    WHERE entry.value ->> 'key' = field_key
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.connection_append_fields(fields jsonb, additions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  output jsonb := COALESCE(fields, '[]'::jsonb);
  item jsonb;
  item_key text;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(additions, '[]'::jsonb))
  LOOP
    item_key := item ->> 'key';
    IF item_key IS NOT NULL AND NOT pg_temp.connection_field_exists(output, item_key) THEN
      output := output || jsonb_build_array(item);
    END IF;
  END LOOP;
  RETURN output;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.upgrade_connection_execution_surface(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  kind text;
  object_key text;
  object_value jsonb;
  output jsonb;
  fields jsonb;
  first_keys text[];
BEGIN
  IF node IS NULL THEN
    RETURN node;
  END IF;

  kind := jsonb_typeof(node);
  IF kind = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(pg_temp.upgrade_connection_execution_surface(items.value) ORDER BY items.ord),
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
      pg_temp.upgrade_connection_execution_surface(object_value)
    );
  END LOOP;

  IF output ->> 'type' <> 'ContractFlowStepEditor' THEN
    RETURN output;
  END IF;

  fields := COALESCE(output #> '{props,fields}', '[]'::jsonb);

  -- Endpoint editor: persistent request/response defaults. Operation-specific
  -- method/path/query/headers/body remain runtime inputs supplied by the caller.
  IF pg_temp.connection_field_exists(fields, 'direction') THEN
    fields := pg_temp.connection_append_fields(fields, $fields$
      [
        {"key":"request_body_encoding","path":"attrs.outbound_request.body_encoding","label":"Request body format","type":"select","options_path":"taxonomy.CONNECTION_BODY_ENCODING","advanced":true,"omit_empty":true},
        {"key":"response_encoding","path":"attrs.outbound_request.response_encoding","label":"Response format","type":"select","options_path":"taxonomy.CONNECTION_RESPONSE_ENCODING","advanced":true,"omit_empty":true},
        {"key":"request_content_type","path":"attrs.outbound_request.content_type","label":"Default content type","advanced":true,"omit_empty":true},
        {"key":"request_accept","path":"attrs.outbound_request.accept","label":"Default Accept","advanced":true,"omit_empty":true}
      ]
    $fields$::jsonb);
  END IF;

  -- Security editor: replace the former raw outbound-auth JSON box with bounded
  -- explicit inputs that the runtime actually consumes.
  IF pg_temp.connection_field_exists(fields, 'verification_mode') THEN
    SELECT COALESCE(jsonb_agg(item.value ORDER BY item.ord), '[]'::jsonb)
    INTO fields
    FROM jsonb_array_elements(fields) WITH ORDINALITY AS item(value, ord)
    WHERE item.value ->> 'key' <> 'outbound_auth_config';

    fields := pg_temp.connection_append_fields(fields, $fields$
      [
        {"key":"outbound_api_key_header","path":"outbound.auth.header_name","label":"API key header","advanced":true,"omit_empty":true},
        {"key":"outbound_api_key_query","path":"outbound.auth.query_param_name","label":"API key query parameter","advanced":true,"omit_empty":true},
        {"key":"outbound_username","path":"outbound.auth.username","label":"Username","advanced":true,"omit_empty":true},
        {"key":"oauth_client_id","path":"outbound.auth.client_id","label":"OAuth client ID","advanced":true,"omit_empty":true},
        {"key":"oauth_token_url","path":"outbound.auth.token_url","label":"OAuth token URL","type":"url","advanced":true,"omit_empty":true},
        {"key":"oauth_scope","path":"outbound.auth.scope","label":"OAuth scope","advanced":true,"omit_empty":true},
        {"key":"oauth_client_auth_method","path":"attrs.oauth_client_credentials.client_auth_method","label":"OAuth client authentication","type":"select","options_path":"taxonomy.CONNECTION_OAUTH_CLIENT_AUTH_METHOD","advanced":true,"omit_empty":true},
        {"key":"oauth_token_body_encoding","path":"attrs.oauth_client_credentials.token_body_encoding","label":"OAuth token body format","type":"select","options_path":"taxonomy.CONNECTION_OAUTH_TOKEN_BODY_ENCODING","advanced":true,"omit_empty":true},
        {"key":"oauth_token_params","path":"attrs.oauth_client_credentials.token_params","label":"OAuth token parameters","type":"json_object","advanced":true,"omit_empty":true},
        {"key":"oauth_token_header","path":"attrs.oauth_client_credentials.token_header_name","label":"Access token header","advanced":true,"omit_empty":true},
        {"key":"oauth_token_prefix","path":"attrs.oauth_client_credentials.token_prefix","label":"Access token prefix","advanced":true,"omit_empty":true},
        {"key":"provider_verifier","path":"attrs.provider_signature.provider_code","label":"Provider verifier","type":"select","options_path":"taxonomy.CONNECTION_PROVIDER_VERIFIER","advanced":true,"omit_empty":true},
        {"key":"provider_signature_header","path":"attrs.provider_signature.header_name","label":"Signature header","advanced":true,"omit_empty":true},
        {"key":"provider_webhook_id","path":"attrs.provider_signature.webhook_id","label":"Webhook ID","advanced":true,"omit_empty":true},
        {"key":"provider_signature_tolerance","path":"attrs.provider_signature.max_skew_sec","label":"Signature tolerance (sec)","type":"number","advanced":true,"omit_empty":true}
      ]
    $fields$::jsonb);
  END IF;

  -- Reliability editor: bounded request/response sizes and the provider's
  -- outbound idempotency-header name are persistent connection policies.
  IF pg_temp.connection_field_exists(fields, 'event_id_location') THEN
    fields := pg_temp.connection_append_fields(fields, $fields$
      [
        {"key":"outbound_idempotency_header","path":"attrs.outbound_request.idempotency_header_name","label":"Outbound idempotency header","advanced":true,"omit_empty":true},
        {"key":"max_request_body_bytes","path":"attrs.outbound_request.max_body_bytes","label":"Max request bytes","type":"number","advanced":true,"omit_empty":true},
        {"key":"max_response_body_bytes","path":"attrs.outbound_request.max_response_bytes","label":"Max response bytes","type":"number","advanced":true,"omit_empty":true}
      ]
    $fields$::jsonb);
  END IF;

  RETURN jsonb_set(output, '{props,fields}', fields, true);
END
$$;

UPDATE eip_core.ui_surface
SET tree = pg_temp.upgrade_connection_execution_surface(tree),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0059"'::jsonb, true),
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
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.key == "request_body_encoding" && @.advanced == true)')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.key == "oauth_client_id" && @.advanced == true)')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.key == "provider_verifier" && @.advanced == true)')
     OR NOT jsonb_path_exists(surface_tree, '$.** ? (@.key == "max_response_body_bytes" && @.advanced == true)')
     OR jsonb_path_exists(surface_tree, '$.** ? (@.key == "outbound_auth_config")')
  THEN
    RAISE EXCEPTION 'v2_0059 Connections execution surface validation failed';
  END IF;

  IF EXISTS (
    SELECT required.code
    FROM (VALUES
      ('CONNECTION_BODY_ENCODING'),
      ('CONNECTION_RESPONSE_ENCODING'),
      ('CONNECTION_OAUTH_CLIENT_AUTH_METHOD'),
      ('CONNECTION_OAUTH_TOKEN_BODY_ENCODING'),
      ('CONNECTION_PROVIDER_VERIFIER')
    ) AS required(code)
    WHERE NOT EXISTS (
      SELECT 1
      FROM eip_core.dropdown_list dl
      WHERE dl.tenant_id IS NULL
        AND dl.module = 'integration'
        AND dl.code = required.code
        AND dl.version = 1
        AND dl.is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'v2_0059 required Connections taxonomy is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.dropdown_list dl
    JOIN eip_core.dropdown_value dv ON dv.list_id = dl.id
    WHERE dl.tenant_id IS NULL
      AND dl.module = 'integration'
      AND dl.code = 'CONNECTION_VERIFICATION_MODE'
      AND dl.version = 1
      AND dl.is_active = true
      AND dv.code = 'provider_signature'
      AND dv.is_active = true
  ) OR NOT EXISTS (
    SELECT 1
    FROM eip_core.dropdown_list dl
    JOIN eip_core.dropdown_value dv ON dv.list_id = dl.id
    WHERE dl.tenant_id IS NULL
      AND dl.module = 'integration'
      AND dl.code = 'CONNECTION_SECRET_KIND'
      AND dl.version = 1
      AND dl.is_active = true
      AND dv.code = 'webhook_signing_secret'
      AND dv.is_active = true
  ) THEN
    RAISE EXCEPTION 'v2_0059 provider verification taxonomy validation failed';
  END IF;
END
$$;

COMMIT;
