BEGIN;

-- Owner Admin V1 -> V2 migration, Wave A/B boundary.
--
-- V1 combined login identity, profile, role assignment and tenant selection in
-- one Users & Roles component. V2 keeps authentication identity separate from
-- the business/organisation Agent. This surface upgrades the read projection
-- now, while leaving access mutation disabled until the V2 access-authority
-- contract is explicitly frozen.
--
-- No new table and no browser-owned tenant selection.

DO $$
BEGIN
  IF to_regclass('eip_core.ui_surface') IS NULL THEN
    RAISE EXCEPTION 'v2_0066 requires eip_core.ui_surface';
  END IF;
  IF to_regclass('eip_auth.auth_identity_agent') IS NULL THEN
    RAISE EXCEPTION 'v2_0066 requires eip_auth.auth_identity_agent';
  END IF;
  IF to_regclass('eip_core.agent') IS NULL THEN
    RAISE EXCEPTION 'v2_0066 requires eip_core.agent';
  END IF;
END
$$;

UPDATE eip_core.ui_surface
SET title = 'Users & Access',
    tree = $json$
{
  "type": "SurfaceRoot",
  "props": {
    "module": "owner_admin",
    "surface_kind": "users_roles",
    "composition": "owner_admin_users_access_v2"
  },
  "children": [
    {
      "id": "owner_users_header",
      "type": "PanelHeader",
      "props": {
        "eyebrow": "Admin Console",
        "title": "Users & Access",
        "subtitle": "Review login identities and their linked organisational Agents."
      }
    },
    {
      "id": "owner_users_table",
      "type": "ContractTablePanel",
      "props": {
        "eyebrow": "Access",
        "title": "Users",
        "list_contract": {
          "method": "GET",
          "endpoint": "/api/eip/owner-admin/users?limit=100"
        },
        "row_id_key": "id",
        "empty_message": "No users are available.",
        "pagination": {
          "enabled": false
        },
        "columns": [
          {
            "key": "login",
            "label": "Login",
            "format": "text"
          },
          {
            "key": "email",
            "label": "Email",
            "format": "text"
          },
          {
            "key": "agent_name",
            "label": "Agent",
            "format": "text"
          },
          {
            "key": "agent_type",
            "label": "Agent Type",
            "format": "text"
          },
          {
            "key": "status",
            "label": "Status",
            "format": "text"
          },
          {
            "key": "permission_count",
            "label": "Permissions",
            "format": "number"
          },
          {
            "key": "updated_at",
            "label": "Updated",
            "format": "datetime"
          }
        ]
      }
    },
    {
      "id": "owner_users_access_boundary",
      "type": "NoticePanel",
      "props": {
        "eyebrow": "Access management",
        "title": "Access changes are protected",
        "message": "Identity, Agent, organisation placement and access authority are separate governed concepts in V2. Editing remains unavailable until the V2 grant/revoke contract is enabled.",
        "items": [
          "Login identity is not the organisational Agent.",
          "Organisation placement is projected from the Agent model.",
          "The browser does not choose tenant or management authority."
        ]
      }
    }
  ]
}
$json$::jsonb,
    attrs = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            COALESCE(attrs, '{}'::jsonb),
            '{source}',
            '"v2_0066"'::jsonb,
            true
          ),
          '{surface_kind}',
          '"users_roles"'::jsonb,
          true
        ),
        '{surface_nav,label}',
        to_jsonb('Users & Access'::text),
        true
      ),
      '{surface_nav,hint}',
      to_jsonb('Login identities, Agent links and governed access'::text),
      true
    ),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_users_roles';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.ui_surface
    WHERE tenant_id IS NULL
      AND version = 1
      AND code = 'owner_users_roles'
      AND title = 'Users & Access'
      AND tree #>> '{props,composition}' = 'owner_admin_users_access_v2'
      AND tree::text LIKE '%/api/eip/owner-admin/users?limit=100%'
      AND tree::text LIKE '%agent_name%'
      AND tree::text LIKE '%agent_type%'
      AND attrs #>> '{surface_nav,label}' = 'Users & Access'
      AND attrs ->> 'source' = 'v2_0066'
  ) THEN
    RAISE EXCEPTION 'v2_0066 could not install the Users & Access projection';
  END IF;
END
$$;

COMMIT;
