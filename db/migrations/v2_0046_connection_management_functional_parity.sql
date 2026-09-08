BEGIN;

-- EIP Core V2 — Connection Management functional parity repair.
--
-- Preserve the accepted seven-step UX while restoring V1 control-plane
-- capabilities through the governed V2 contracts. The authenticated session is
-- the tenant authority; no tenant selector or tenant override is introduced.

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

  IF composition IS DISTINCT FROM 'connection_setup_v1' THEN
    RAISE EXCEPTION 'v2_0046 requires owner_connections connection_setup_v1; found %', composition;
  END IF;
END
$$;

-- Promote the validated composition revision and make tenant ownership explicit
-- in the UX without giving the browser any tenant authority.
UPDATE eip_core.ui_surface
SET tree = jsonb_set(tree, '{props,composition}', '"connection_setup_v2"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_connections';

UPDATE eip_core.ui_surface
SET tree = jsonb_set(
      tree,
      '{children,0,props,subtitle}',
      to_jsonb('Manage external gateways for the authenticated organisation. Every connection and credential is tenant-scoped; no cross-tenant browser override is permitted.'::text),
      true
    ),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_connections';

-- Identity lifecycle: physical deletion is intentionally replaced by governed
-- deprecation. The server disables the profile and revokes active credentials
-- while retaining history for audit/evidence.
UPDATE eip_core.ui_surface
SET tree = jsonb_set(
      tree,
      '{children,1,children,1,children,1,children,0,children}',
      COALESCE(tree #> '{children,1,children,1,children,1,children,0,children}', '[]'::jsonb)
      || $json$
      [
        {
          "type":"ContractActionPanel",
          "props":{
            "record_selection_target":"connection",
            "record_key":"connection_code",
            "record_path_param":"code",
            "permissions_any":["OWNER_ADMIN_CONNECTION_WRITE"],
            "title":"Connection lifecycle",
            "subtitle":"Delete removes the connection from active use while preserving audit history.",
            "actions":[
              {
                "id":"delete_connection",
                "label":"Delete connection",
                "button_kind":"danger",
                "confirm_message":"Delete this connection? It will be disabled, deprecated and all active credentials will be revoked. Audit history is retained.",
                "success_message":"Connection deleted from active use.",
                "contract":{"method":"DELETE","endpoint":"/api/eip/owner-admin/connections/:code"},
                "permissions_any":["OWNER_ADMIN_CONNECTION_WRITE"],
                "clear_selection_target":"connection"
              }
            ]
          }
        }
      ]
      $json$::jsonb,
      true
    ),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_connections';

-- Security form: expose the known V1 non-secret authentication parameters as
-- guided advanced fields rather than forcing operators to edit opaque JSON.
UPDATE eip_core.ui_surface
SET tree = jsonb_set(
      tree,
      '{children,1,children,1,children,1,children,2,children,0,props,fields}',
      $json$
      [
        {"key":"verification_mode","path":"verification.mode","label":"Inbound verification","type":"select","options_path":"taxonomy.CONNECTION_VERIFICATION_MODE","omit_empty":true},
        {"key":"outbound_auth_mode","path":"outbound.auth_mode","label":"Outbound authentication","type":"select","options_path":"taxonomy.CONNECTION_AUTH_MODE","omit_empty":true},
        {"key":"allow_unverified","path":"verification.allow_unverified","label":"Allow unverified","type":"checkbox","help":"Production inbound connections cannot enable this."},
        {"key":"api_key_header","path":"verification.api_key.header_name","label":"API-key header","advanced":true,"omit_empty":true},

        {"key":"hmac_header_name","path":"verification.hmac_signature.header_name","label":"HMAC signature header","advanced":true,"omit_empty":true},
        {"key":"hmac_algorithm","path":"verification.hmac_signature.algorithm","label":"HMAC algorithm","advanced":true,"omit_empty":true},
        {"key":"hmac_encoding","path":"verification.hmac_signature.encoding","label":"HMAC encoding","advanced":true,"omit_empty":true},
        {"key":"hmac_payload_mode","path":"verification.hmac_signature.payload_mode","label":"HMAC payload mode","advanced":true,"omit_empty":true},
        {"key":"hmac_timestamp_header","path":"verification.hmac_signature.timestamp_header","label":"HMAC timestamp header","advanced":true,"omit_empty":true},
        {"key":"hmac_max_skew_sec","path":"verification.hmac_signature.max_skew_sec","label":"HMAC max skew (sec)","type":"number","advanced":true,"omit_empty":true},

        {"key":"jwt_header_name","path":"verification.oauth2_jwt.header_name","label":"JWT header","advanced":true,"omit_empty":true},
        {"key":"jwt_token_prefix","path":"verification.oauth2_jwt.token_prefix","label":"JWT token prefix","advanced":true,"omit_empty":true},
        {"key":"jwt_issuer","path":"verification.oauth2_jwt.issuer","label":"JWT issuer","advanced":true,"omit_empty":true},
        {"key":"jwt_audience","path":"verification.oauth2_jwt.audience","label":"JWT audience","advanced":true,"omit_empty":true},
        {"key":"jwt_jwks_url","path":"verification.oauth2_jwt.jwks_url","label":"JWKS URL","type":"url","advanced":true,"omit_empty":true},
        {"key":"jwt_max_skew_sec","path":"verification.oauth2_jwt.max_skew_sec","label":"JWT max skew (sec)","type":"number","advanced":true,"omit_empty":true},
        {"key":"jwt_max_age_sec","path":"verification.oauth2_jwt.max_age_sec","label":"JWT max age (sec)","type":"number","advanced":true,"omit_empty":true},

        {"key":"auth_header_name","path":"outbound.auth.header_name","label":"Outbound auth header","advanced":true,"omit_empty":true},
        {"key":"auth_query_param_name","path":"outbound.auth.query_param_name","label":"Outbound auth query parameter","advanced":true,"omit_empty":true},
        {"key":"auth_public_key_ref","path":"outbound.auth.public_key_ref","label":"Public key reference","advanced":true,"omit_empty":true},
        {"key":"auth_username","path":"outbound.auth.username","label":"Username","advanced":true,"omit_empty":true},
        {"key":"auth_client_id","path":"outbound.auth.client_id","label":"OAuth client ID","advanced":true,"omit_empty":true},
        {"key":"auth_client_method","path":"outbound.auth.client_auth_method","label":"Client authentication method","advanced":true,"omit_empty":true},
        {"key":"auth_token_url","path":"outbound.auth.token_url","label":"OAuth token URL","type":"url","advanced":true,"omit_empty":true},
        {"key":"auth_scope","path":"outbound.auth.scope","label":"OAuth scope","advanced":true,"omit_empty":true}
      ]
      $json$::jsonb,
      true
    ),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_connections';

-- Add a server-generated API-key operation before the manual rotate/revoke tools.
-- The raw key exists only in the immediate response and is rendered transiently
-- with an explicit copy-now warning.
UPDATE eip_core.ui_surface
SET tree = jsonb_set(
      tree,
      '{children,1,children,1,children,1,children,2,children}',
      jsonb_build_array(
        tree #> '{children,1,children,1,children,1,children,2,children,0}',
        $json$
        {
          "type":"ContractActionPanel",
          "props":{
            "record_selection_target":"connection",
            "record_key":"connection_code",
            "record_path_param":"code",
            "permissions_any":["OWNER_ADMIN_CONNECTION_SECRET_MANAGE"],
            "title":"Generate API key",
            "subtitle":"Generate a cryptographically random API key and store it encrypted for this connection.",
            "actions":[
              {
                "id":"generate_api_key",
                "label":"Generate API key",
                "contract":{"method":"POST","endpoint":"/api/eip/owner-admin/connections/:code/api-key/generate"},
                "permissions_any":["OWNER_ADMIN_CONNECTION_SECRET_MANAGE"],
                "success_message":"API key generated.",
                "result_notice":"Copy this API key now. For security it will not be shown again.",
                "result_fields":[
                  {"path":"raw_key","label":"Generated API key","copyable":true,"sensitive":true}
                ]
              }
            ]
          }
        }
        $json$::jsonb,
        tree #> '{children,1,children,1,children,1,children,2,children,1}',
        tree #> '{children,1,children,1,children,1,children,2,children,2}'
      ),
      true
    ),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_connections';

-- Keep provider-specific evolution metadata-driven. Operators may attach bounded
-- non-secret provider metadata without waiting for a React change. The server
-- rejects secret-bearing keys recursively before persistence.
UPDATE eip_core.ui_surface
SET tree = jsonb_set(
      tree,
      '{children,1,children,1,children,1,children,4,children,0,props,fields}',
      COALESCE(tree #> '{children,1,children,1,children,1,children,4,children,0,props,fields}', '[]'::jsonb)
      || $json$
      [
        {
          "key":"provider_extensions",
          "path":"attrs",
          "label":"Provider extension metadata",
          "type":"json_object",
          "advanced":true,
          "omit_empty":true,
          "help":"Non-secret provider-specific capabilities and parameters. Credentials must use the Security credential lifecycle."
        }
      ]
      $json$::jsonb,
      true
    ),
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0046"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_connections';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.ui_surface
    WHERE tenant_id IS NULL
      AND version = 1
      AND code = 'owner_connections'
      AND tree #>> '{props,composition}' = 'connection_setup_v2'
      AND tree::text LIKE '%/api/eip/owner-admin/connections/:code/api-key/generate%'
      AND tree::text LIKE '%"method": "DELETE"%'
      AND tree::text NOT LIKE '%tenant_id%'
  ) THEN
    RAISE EXCEPTION 'v2_0046 connection functional parity composition validation failed';
  END IF;
END
$$;

COMMIT;
