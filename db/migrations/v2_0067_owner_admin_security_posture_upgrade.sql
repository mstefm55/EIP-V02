BEGIN;

-- Owner Admin V1 -> V2 migration, Wave A security UX upgrade.
--
-- Reuses the useful V1 security-overview pattern (compact posture metrics +
-- operational lists) but binds exclusively to V2 Auth/session/device DTOs.
-- Recovery/passkey mutation is intentionally not copied from V1 until the V2
-- security contract explicitly supports it.
--
-- No secret material and no new table.

DO $$
BEGIN
  IF to_regclass('eip_core.ui_surface') IS NULL THEN
    RAISE EXCEPTION 'v2_0067 requires eip_core.ui_surface';
  END IF;
  IF to_regclass('eip_auth.auth_session') IS NULL THEN
    RAISE EXCEPTION 'v2_0067 requires eip_auth.auth_session';
  END IF;
  IF to_regclass('eip_auth.auth_device') IS NULL THEN
    RAISE EXCEPTION 'v2_0067 requires eip_auth.auth_device';
  END IF;
END
$$;

UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type": "SurfaceRoot",
  "props": {
    "module": "owner_admin",
    "surface_kind": "security",
    "composition": "owner_admin_security_posture_v2"
  },
  "children": [
    {
      "id": "owner_security_header",
      "type": "PanelHeader",
      "props": {
        "eyebrow": "Admin Console",
        "title": "Security",
        "subtitle": "Review active sessions, identity lock state, and browser device trust."
      }
    },
    {
      "id": "owner_security_metrics",
      "type": "ContractMetricGrid",
      "props": {
        "eyebrow": "Current posture",
        "title": "Authentication overview",
        "data_contract": {
          "method": "GET",
          "endpoint": "/api/eip/owner-admin/security/overview"
        },
        "metrics_path": "metrics",
        "metrics": [
          {
            "key": "active_sessions",
            "label": "Active Sessions",
            "format": "number"
          },
          {
            "key": "active_identities",
            "label": "Active Users",
            "format": "number"
          },
          {
            "key": "locked_identities",
            "label": "Locked Users",
            "format": "number"
          },
          {
            "key": "trusted_devices",
            "label": "Trusted Devices",
            "format": "number"
          },
          {
            "key": "untrusted_devices",
            "label": "Untrusted Devices",
            "format": "number"
          },
          {
            "key": "revoked_devices",
            "label": "Revoked Devices",
            "format": "number"
          }
        ]
      }
    },
    {
      "id": "owner_security_tabs",
      "type": "Tabs",
      "props": {
        "title": "Security details",
        "default_tab_id": "sessions",
        "tabs": [
          {
            "id": "sessions",
            "label": "Active Sessions",
            "child_id": "owner_security_sessions",
            "icon": "session"
          },
          {
            "id": "devices",
            "label": "Devices",
            "child_id": "owner_security_devices",
            "icon": "session"
          }
        ]
      },
      "children": [
        {
          "id": "owner_security_sessions",
          "type": "ContractTablePanel",
          "props": {
            "title": "Active sessions",
            "list_contract": {
              "method": "GET",
              "endpoint": "/api/eip/owner-admin/security/sessions?limit=100"
            },
            "row_id_key": "row_key",
            "empty_message": "No active sessions are available.",
            "columns": [
              {
                "key": "login",
                "label": "Login",
                "format": "text"
              },
              {
                "key": "device_trust",
                "label": "Device",
                "format": "text"
              },
              {
                "key": "assurance",
                "label": "Assurance",
                "format": "text"
              },
              {
                "key": "issued_at",
                "label": "Issued",
                "format": "datetime"
              },
              {
                "key": "last_seen_at",
                "label": "Last Seen",
                "format": "datetime"
              },
              {
                "key": "expires_at",
                "label": "Expires",
                "format": "datetime"
              }
            ]
          }
        },
        {
          "id": "owner_security_devices",
          "type": "ContractTablePanel",
          "props": {
            "title": "Browser devices",
            "list_contract": {
              "method": "GET",
              "endpoint": "/api/eip/owner-admin/security/devices?limit=100"
            },
            "row_id_key": "id",
            "empty_message": "No browser devices are registered.",
            "columns": [
              {
                "key": "login",
                "label": "Login",
                "format": "text"
              },
              {
                "key": "trust_state",
                "label": "Trust",
                "format": "text"
              },
              {
                "key": "first_seen_at",
                "label": "First Seen",
                "format": "datetime"
              },
              {
                "key": "last_seen_at",
                "label": "Last Seen",
                "format": "datetime"
              },
              {
                "key": "revoked_at",
                "label": "Revoked",
                "format": "datetime"
              }
            ]
          }
        }
      ]
    },
    {
      "id": "owner_security_boundary",
      "type": "NoticePanel",
      "props": {
        "eyebrow": "Security controls",
        "title": "Protected actions remain server governed",
        "message": "Credential recovery, passkey administration, trust changes and other privileged actions are not inferred from this dashboard. They return only through dedicated V2 security contracts and step-up policy."
      }
    }
  ]
}
$json$::jsonb,
    attrs = jsonb_set(
      jsonb_set(
        COALESCE(attrs, '{}'::jsonb),
        '{source}',
        '"v2_0067"'::jsonb,
        true
      ),
      '{surface_nav,hint}',
      to_jsonb('Sessions, identities and device trust posture'::text),
      true
    ),
    updated_at = now()
WHERE tenant_id IS NULL
  AND version = 1
  AND code = 'owner_security';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.ui_surface
    WHERE tenant_id IS NULL
      AND version = 1
      AND code = 'owner_security'
      AND tree #>> '{props,composition}' = 'owner_admin_security_posture_v2'
      AND tree::text LIKE '%/api/eip/owner-admin/security/overview%'
      AND tree::text LIKE '%/api/eip/owner-admin/security/sessions?limit=100%'
      AND tree::text LIKE '%/api/eip/owner-admin/security/devices?limit=100%'
      AND attrs ->> 'source' = 'v2_0067'
  ) THEN
    RAISE EXCEPTION 'v2_0067 could not install the Security posture upgrade';
  END IF;
END
$$;

COMMIT;
