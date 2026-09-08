BEGIN;

-- EIP Core V2 — expose inbound configuration readiness in the accepted
-- Connection Management flow. This does not claim that the V1 public inbound
-- gateway runtime has already been restored; the result explicitly reports that
-- boundary until the separate runtime migration wave is completed.

DO $$
DECLARE
  composition text;
BEGIN
  SELECT tree #>> '{props,composition}'
  INTO composition
  FROM eip_core.ui_surface
  WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_connections'
  LIMIT 1;

  IF composition IS DISTINCT FROM 'connection_setup_v2' THEN
    RAISE EXCEPTION 'v2_0047 requires owner_connections connection_setup_v2; found %', composition;
  END IF;
END
$$;

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
            "permissions_any":["OWNER_ADMIN_CONNECTION_TEST"],
            "title":"Inbound readiness",
            "subtitle":"Validate the tenant-scoped inbound profile and credential readiness. This is a configuration check until the public inbound gateway runtime is restored.",
            "actions":[
              {
                "id":"inbound_readiness",
                "label":"Check inbound readiness",
                "contract":{"method":"POST","endpoint":"/api/eip/owner-admin/connections/:code/test/inbound-readiness"},
                "permissions_any":["OWNER_ADMIN_CONNECTION_TEST"],
                "result_notice":"Configuration readiness is distinct from live inbound runtime availability.",
                "result_fields":[
                  {"path":"result.configured","label":"Configuration ready"},
                  {"path":"result.runtime_status","label":"Runtime status"},
                  {"path":"result.direction","label":"Direction"},
                  {"path":"result.verification_mode","label":"Verification"},
                  {"path":"result.required_secret_kind","label":"Required credential"}
                ]
              }
            ]
          }
        }
      ]
      $json$::jsonb,
      true
    ),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0047"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_connections';

COMMIT;
