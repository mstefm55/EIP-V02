BEGIN;

-- EIP Core V2 — align the accepted Connections Test & Health step with the
-- restored public inbound transport runtime. Endpoint URLs are server-projected
-- from the authenticated tenant and kernel tenant code; the browser never owns
-- or overrides tenant authority.

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
    RAISE EXCEPTION 'v2_0048 requires owner_connections connection_setup_v2; found %', composition;
  END IF;
END
$$;

-- Replace the temporary "runtime not restored" copy without relying on the
-- panel's array position. The panel remains a generic ContractActionPanel.
UPDATE eip_core.ui_surface s
SET tree = jsonb_set(
      s.tree,
      '{children,1,children,1,children,1,children,5,children}',
      COALESCE(
        (
          SELECT jsonb_agg(
            CASE
              WHEN child #>> '{props,title}' = 'Inbound readiness' THEN
                jsonb_set(
                  jsonb_set(
                    child,
                    '{props,subtitle}',
                    to_jsonb('Validate the tenant-scoped inbound profile, credentials and live transport support before activation.'::text),
                    true
                  ),
                  '{props,actions,0,result_notice}',
                  to_jsonb('Runtime availability reflects the currently supported verification modes. Business dispatch remains governed by Process/Service Object bindings.'::text),
                  true
                )
              ELSE child
            END
            ORDER BY ordinal
          )
          FROM jsonb_array_elements(
            COALESCE(s.tree #> '{children,1,children,1,children,1,children,5,children}', '[]'::jsonb)
          ) WITH ORDINALITY AS entries(child, ordinal)
        ),
        '[]'::jsonb
      ),
      true
    ),
    updated_at = now()
WHERE s.tenant_id IS NULL
  AND s.version = 1
  AND s.code = 'owner_connections';

-- Show the actual tenant-aware public/EDI endpoint in Test & Health. The route
-- resolves the tenant from the authenticated session and kernel registry; no
-- tenant_id or tenant selector is accepted from surface metadata.
UPDATE eip_core.ui_surface
SET tree = jsonb_set(
      tree,
      '{children,1,children,1,children,1,children,5,children}',
      COALESCE(tree #> '{children,1,children,1,children,1,children,5,children}', '[]'::jsonb)
      || $json$
      [
        {
          "type":"ContractActionPanel",
          "props":{
            "record_selection_target":"connection",
            "record_key":"connection_code",
            "record_path_param":"code",
            "permissions_any":["OWNER_ADMIN_CONNECTION_READ"],
            "title":"Inbound endpoint",
            "subtitle":"Resolve the live endpoint for this connection and authenticated organisation.",
            "actions":[
              {
                "id":"resolve_inbound_endpoint",
                "label":"Show endpoint",
                "contract":{"method":"GET","endpoint":"/api/eip/owner-admin/connections/:code/endpoints"},
                "permissions_any":["OWNER_ADMIN_CONNECTION_READ"],
                "result_notice":"Use the endpoint matching the configured channel. Tenant routing is derived server-side and cannot be overridden by the browser.",
                "result_fields":[
                  {"path":"endpoints.runtime_status","label":"Runtime status"},
                  {"path":"endpoints.configuration_ready","label":"Configuration ready"},
                  {"path":"endpoints.activation_ready","label":"Activation ready"},
                  {"path":"endpoints.channel","label":"Channel"},
                  {"path":"endpoints.verification_mode","label":"Verification"},
                  {"path":"endpoints.public_intake_url","label":"Public intake URL","copyable":true},
                  {"path":"endpoints.edi_webhook_url","label":"EDI webhook URL","copyable":true}
                ]
              }
            ]
          }
        }
      ]
      $json$::jsonb,
      true
    ),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0048"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_connections';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.ui_surface
    WHERE tenant_id IS NULL
      AND version = 1
      AND code = 'owner_connections'
      AND tree #>> '{props,composition}' = 'connection_setup_v2'
      AND tree::text LIKE '%/api/eip/owner-admin/connections/:code/endpoints%'
      AND tree::text LIKE '%Public intake URL%'
      AND tree::text NOT LIKE '%PUBLIC_INBOUND_RUNTIME_NOT_RESTORED%'
      AND tree::text NOT LIKE '%"path": "tenant_id"%'
      AND tree::text NOT LIKE '%"key": "tenant_id"%'
  ) THEN
    RAISE EXCEPTION 'v2_0048 live endpoint projection validation failed';
  END IF;
END
$$;

COMMIT;
