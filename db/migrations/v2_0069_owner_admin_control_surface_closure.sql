BEGIN;

-- EIP Core V2 — Owner Admin control surface closure.
--
-- This wave binds the existing metadata-driven UI engine to the governed
-- control-plane routes introduced by v2_0068. It does not create another auth,
-- tenant, process, effect, connection or reasoning engine. Browser tenant
-- authority remains forbidden; all contracts below derive tenant scope from the
-- authenticated server session.

DO $$
BEGIN
  IF to_regclass('eip_core.ui_surface') IS NULL THEN
    RAISE EXCEPTION 'v2_0069 requires eip_core.ui_surface';
  END IF;
  IF to_regclass('kernel.tenant_request') IS NULL THEN
    RAISE EXCEPTION 'v2_0069 requires kernel.tenant_request from v2_0068';
  END IF;
  IF to_regclass('security.audit_event') IS NULL THEN
    RAISE EXCEPTION 'v2_0069 requires security.audit_event from v2_0068';
  END IF;
END
$$;

-- Older bootstrap attempts could have been marked EXPIRED after an organisation
-- and initial identity already existed. Move those rows back to the recoverable
-- pending state so the governed resend action rotates the token instead of
-- forcing a second approval/tenant creation path.
UPDATE kernel.tenant_request
SET status_code = 'BOOTSTRAP_PENDING',
    bootstrap_token_hash = NULL,
    bootstrap_expires_at = NULL,
    updated_at = now(),
    attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object(
      'recovery',
      jsonb_build_object('reason', 'v2_0069_expired_bootstrap_recovery', 'at', now())
    )
WHERE status_code = 'EXPIRED'
  AND tenant_id IS NOT NULL
  AND admin_identity_id IS NOT NULL
  AND bootstrap_used_at IS NULL;

-- ---------------------------------------------------------------------------
-- Tenant Requests — persisted pre-tenant queue + approve/reject/resend.
-- ---------------------------------------------------------------------------
UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type":"SurfaceRoot",
  "props":{"module":"owner_admin","surface_kind":"tenant_requests","composition":"owner_admin_tenant_requests_control_v2"},
  "children":[
    {
      "id":"owner_tenant_requests_header",
      "type":"PanelHeader",
      "props":{"eyebrow":"Admin Console","title":"Tenant Requests","subtitle":"Review access requests and govern organisation activation."}
    },
    {
      "id":"owner_tenant_requests_layout",
      "type":"SplitLayout",
      "props":{"columns":2,"min_column_width":"320px"},
      "children":[
        {
          "id":"owner_tenant_requests_table",
          "type":"ContractTablePanel",
          "props":{
            "eyebrow":"Onboarding queue",
            "title":"Requests",
            "list_contract":{"method":"GET","endpoint":"/api/eip/owner-admin/control/tenant-requests?limit=100"},
            "row_id_key":"id",
            "empty_message":"No access requests are waiting for review.",
            "pagination":{"enabled":false},
            "selection":{"target":"tenant_request","key":"id","auto_select_first":true,"refresh_selected_record":true},
            "columns":[
              {"key":"ref_code","label":"Reference","format":"text"},
              {"key":"legal_name","label":"Organisation","format":"text"},
              {"key":"email","label":"Email","format":"text"},
              {"key":"applicant_type","label":"Type","format":"text"},
              {"key":"status_code","label":"Status","format":"text"},
              {"key":"country","label":"Country","format":"text"},
              {"key":"created_at","label":"Requested","format":"datetime"}
            ]
          }
        },
        {
          "id":"owner_tenant_requests_actions",
          "type":"Stack",
          "children":[
            {
              "id":"owner_tenant_requests_primary_actions",
              "type":"ContractActionPanel",
              "props":{
                "record_selection_target":"tenant_request",
                "record_key":"id",
                "record_path_param":"id",
                "permissions_any":["OWNER_ADMIN_TENANT_REQUEST_WRITE"],
                "title":"Review request",
                "subtitle":"Approval creates a suspended organisation and a one-time activation link. Resend rotates the link without creating another organisation.",
                "actions":[
                  {
                    "id":"approve_tenant_request",
                    "label":"Approve request",
                    "confirm_message":"Approve this access request and create its organisation?",
                    "contract":{"method":"POST","endpoint":"/api/eip/owner-admin/control/tenant-requests/:id/approve"},
                    "permissions_any":["OWNER_ADMIN_TENANT_REQUEST_WRITE"],
                    "success_message":"Request approved. The activation link has been issued."
                  },
                  {
                    "id":"resend_tenant_bootstrap",
                    "label":"Resend activation link",
                    "contract":{"method":"POST","endpoint":"/api/eip/owner-admin/control/tenant-requests/:id/resend"},
                    "permissions_any":["OWNER_ADMIN_TENANT_REQUEST_WRITE"],
                    "success_message":"A new activation link has been issued."
                  }
                ]
              }
            },
            {
              "id":"owner_tenant_requests_reject",
              "type":"ContractActionPanel",
              "props":{
                "record_selection_target":"tenant_request",
                "record_key":"id",
                "record_path_param":"id",
                "permissions_any":["OWNER_ADMIN_TENANT_REQUEST_WRITE"],
                "title":"Reject request",
                "subtitle":"Record the review reason before rejecting the request.",
                "fields":[
                  {"key":"reason","path":"reason","label":"Reason","type":"textarea","rows":3,"required":true}
                ],
                "actions":[
                  {
                    "id":"reject_tenant_request",
                    "label":"Reject request",
                    "button_kind":"danger",
                    "confirm_message":"Reject this access request?",
                    "contract":{"method":"POST","endpoint":"/api/eip/owner-admin/control/tenant-requests/:id/reject"},
                    "payload":{"reason":"$draft.reason"},
                    "permissions_any":["OWNER_ADMIN_TENANT_REQUEST_WRITE"],
                    "success_message":"Request rejected."
                  }
                ]
              }
            }
          ]
        }
      ]
    }
  ]
}
$json$::jsonb,
    attrs = jsonb_set(
      jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0069"'::jsonb, true),
      '{surface_kind}', '"tenant_requests"'::jsonb, true
    ),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_tenant_requests';

-- ---------------------------------------------------------------------------
-- Users & Access — create users, link Agent, grant/revoke access and lock state.
-- ---------------------------------------------------------------------------
UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type":"SurfaceRoot",
  "props":{"module":"owner_admin","surface_kind":"users_roles","composition":"owner_admin_access_control_v2"},
  "children":[
    {
      "id":"owner_users_header",
      "type":"PanelHeader",
      "props":{"eyebrow":"Admin Console","title":"Users & Access","subtitle":"Manage login identities, organisational Agent links and permission grants."}
    },
    {
      "id":"owner_users_layout",
      "type":"SplitLayout",
      "props":{"columns":2,"min_column_width":"340px"},
      "children":[
        {
          "id":"owner_users_table",
          "type":"ContractTablePanel",
          "props":{
            "eyebrow":"Access",
            "title":"Users",
            "list_contract":{"method":"GET","endpoint":"/api/eip/owner-admin/control/users?limit=100"},
            "row_id_key":"id",
            "empty_message":"No users are available.",
            "pagination":{"enabled":false},
            "selection":{
              "target":"admin_user",
              "key":"id",
              "auto_select_first":true,
              "refresh_selected_record":true,
              "clear_on_new":true,
              "new_action":{"label":"New user","requires_any_permission":["OWNER_ADMIN_ACCESS_WRITE"]}
            },
            "columns":[
              {"key":"login","label":"Login","format":"text"},
              {"key":"email","label":"Email","format":"text"},
              {"key":"agent_name","label":"Agent","format":"text"},
              {"key":"status","label":"Status","format":"text"},
              {"key":"permission_count","label":"Permissions","format":"number"},
              {"key":"updated_at","label":"Updated","format":"datetime"}
            ]
          }
        },
        {
          "id":"owner_users_controls",
          "type":"Stack",
          "children":[
            {
              "id":"owner_users_create",
              "type":"ContractActionPanel",
              "props":{
                "record_required":false,
                "permissions_any":["OWNER_ADMIN_ACCESS_WRITE"],
                "options_contract":{"method":"GET","endpoint":"/api/eip/owner-admin/control/agents?limit=200"},
                "title":"Create user",
                "subtitle":"Create a login with a strong password. Permissions can be assigned after creation.",
                "fields":[
                  {"key":"login","path":"login","label":"Login","required":true},
                  {"key":"email","path":"email","label":"Email","type":"email","omit_empty":true},
                  {"key":"password","path":"password","label":"Temporary password","type":"password","required":true,"omit_empty":true},
                  {"key":"agent_id","path":"agent_id","label":"Agent","type":"select","options_path":"items","option_value_key":"id","option_label_key":"label","omit_empty":true}
                ],
                "actions":[
                  {
                    "id":"create_admin_user",
                    "label":"Create user",
                    "contract":{"method":"POST","endpoint":"/api/eip/owner-admin/control/users"},
                    "payload":{"login":"$draft.login","email":"$draft.email","password":"$draft.password","permissions":[],"agent_id":"$draft.agent_id"},
                    "permissions_any":["OWNER_ADMIN_ACCESS_WRITE"],
                    "success_message":"User created. Select the user to assign access."
                  }
                ]
              }
            },
            {
              "id":"owner_users_update",
              "type":"ContractFlowStepEditor",
              "props":{
                "record_selection_target":"admin_user",
                "record_key":"id",
                "record_path_param":"id",
                "update_contract":{"method":"PATCH","endpoint":"/api/eip/owner-admin/control/users/:id"},
                "update_item_path":"user",
                "options_contract":{"method":"GET","endpoint":"/api/eip/owner-admin/control/agents?limit=200"},
                "permissions_any":["OWNER_ADMIN_ACCESS_WRITE"],
                "selection_required_message":"Select a user to manage access.",
                "save_label":"Save access changes",
                "saved_message":"Access changes saved.",
                "fields":[
                  {"key":"is_active","path":"is_active","label":"Active","type":"checkbox"},
                  {"key":"is_locked","path":"is_locked","label":"Locked","type":"checkbox"},
                  {"key":"permissions","path":"permissions","label":"Permission codes","type":"string_list","rows":8,"help":"One permission code per line."},
                  {"key":"agent_id","path":"agent_id","label":"Primary Agent","type":"select","options_path":"items","option_value_key":"id","option_label_key":"label","omit_empty":true}
                ]
              }
            }
          ]
        }
      ]
    }
  ]
}
$json$::jsonb,
    attrs = jsonb_set(
      jsonb_set(
        jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0069"'::jsonb, true),
        '{surface_kind}', '"users_roles"'::jsonb, true
      ),
      '{surface_nav,label}', to_jsonb('Users & Access'::text), true
    ),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_users_roles';

-- ---------------------------------------------------------------------------
-- Security — revoke sessions and govern device trust while retaining posture.
-- ---------------------------------------------------------------------------
UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type":"SurfaceRoot",
  "props":{"module":"owner_admin","surface_kind":"security","composition":"owner_admin_security_control_v2"},
  "children":[
    {
      "id":"owner_security_header",
      "type":"PanelHeader",
      "props":{"eyebrow":"Admin Console","title":"Security","subtitle":"Review authentication posture and take governed session or device actions."}
    },
    {
      "id":"owner_security_metrics",
      "type":"ContractMetricGrid",
      "props":{
        "eyebrow":"Current posture",
        "title":"Authentication overview",
        "data_contract":{"method":"GET","endpoint":"/api/eip/owner-admin/security/overview"},
        "metrics_path":"metrics",
        "metrics":[
          {"key":"active_sessions","label":"Active Sessions","format":"number"},
          {"key":"active_identities","label":"Active Users","format":"number"},
          {"key":"locked_identities","label":"Locked Users","format":"number"},
          {"key":"trusted_devices","label":"Trusted Devices","format":"number"},
          {"key":"untrusted_devices","label":"Untrusted Devices","format":"number"},
          {"key":"revoked_devices","label":"Revoked Devices","format":"number"}
        ]
      }
    },
    {
      "id":"owner_security_tabs",
      "type":"Tabs",
      "props":{
        "title":"Security controls",
        "default_tab_id":"sessions",
        "tabs":[
          {"id":"sessions","label":"Sessions","child_id":"owner_security_session_stack","icon":"session"},
          {"id":"devices","label":"Devices","child_id":"owner_security_device_stack","icon":"session"}
        ]
      },
      "children":[
        {
          "id":"owner_security_session_stack",
          "type":"Stack",
          "children":[
            {
              "id":"owner_security_sessions",
              "type":"ContractTablePanel",
              "props":{
                "title":"Active sessions",
                "list_contract":{"method":"GET","endpoint":"/api/eip/owner-admin/control/security/sessions?limit=100"},
                "row_id_key":"id",
                "empty_message":"No active sessions are available.",
                "pagination":{"enabled":false},
                "selection":{"target":"admin_session","key":"id","auto_select_first":false,"refresh_selected_record":true},
                "columns":[
                  {"key":"login","label":"Login","format":"text"},
                  {"key":"device_trust","label":"Device","format":"text"},
                  {"key":"assurance","label":"Assurance","format":"text"},
                  {"key":"issued_at","label":"Issued","format":"datetime"},
                  {"key":"last_seen_at","label":"Last Seen","format":"datetime"},
                  {"key":"expires_at","label":"Expires","format":"datetime"}
                ]
              }
            },
            {
              "id":"owner_security_revoke_session",
              "type":"ContractActionPanel",
              "props":{
                "record_selection_target":"admin_session",
                "record_key":"id",
                "record_path_param":"id",
                "permissions_any":["OWNER_ADMIN_SECURITY_WRITE"],
                "title":"Session control",
                "subtitle":"Revoke a selected session. The current session cannot revoke itself.",
                "actions":[
                  {
                    "id":"revoke_session",
                    "label":"Revoke session",
                    "button_kind":"danger",
                    "confirm_message":"Revoke the selected session?",
                    "contract":{"method":"POST","endpoint":"/api/eip/owner-admin/control/security/sessions/:id/revoke"},
                    "permissions_any":["OWNER_ADMIN_SECURITY_WRITE"],
                    "success_message":"Session revoked."
                  }
                ]
              }
            }
          ]
        },
        {
          "id":"owner_security_device_stack",
          "type":"Stack",
          "children":[
            {
              "id":"owner_security_devices",
              "type":"ContractTablePanel",
              "props":{
                "title":"Browser devices",
                "list_contract":{"method":"GET","endpoint":"/api/eip/owner-admin/security/devices?limit=100"},
                "row_id_key":"id",
                "empty_message":"No browser devices are registered.",
                "pagination":{"enabled":false},
                "selection":{"target":"admin_device","key":"id","auto_select_first":false,"refresh_selected_record":true},
                "columns":[
                  {"key":"login","label":"Login","format":"text"},
                  {"key":"trust_state","label":"Trust","format":"text"},
                  {"key":"first_seen_at","label":"First Seen","format":"datetime"},
                  {"key":"last_seen_at","label":"Last Seen","format":"datetime"},
                  {"key":"revoked_at","label":"Revoked","format":"datetime"}
                ]
              }
            },
            {
              "id":"owner_security_device_action",
              "type":"ContractActionPanel",
              "props":{
                "record_selection_target":"admin_device",
                "record_key":"id",
                "record_path_param":"id",
                "permissions_any":["OWNER_ADMIN_SECURITY_WRITE"],
                "title":"Device trust",
                "fields":[
                  {"key":"trust_state","path":"trust_state","label":"Trust state","type":"select","required":true,"options":[{"value":"trusted","label":"Trusted"},{"value":"untrusted","label":"Untrusted"},{"value":"revoked","label":"Revoked"}]}
                ],
                "actions":[
                  {
                    "id":"update_device_trust",
                    "label":"Apply trust state",
                    "confirm_message":"Apply this trust state to the selected device?",
                    "contract":{"method":"PATCH","endpoint":"/api/eip/owner-admin/control/security/devices/:id"},
                    "payload":{"trust_state":"$draft.trust_state"},
                    "permissions_any":["OWNER_ADMIN_SECURITY_WRITE"],
                    "success_message":"Device trust updated."
                  }
                ]
              }
            }
          ]
        }
      ]
    }
  ]
}
$json$::jsonb,
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0069"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_security';

-- ---------------------------------------------------------------------------
-- Settings — tenant-RLS governed JSON configuration editing.
-- ---------------------------------------------------------------------------
UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type":"SurfaceRoot",
  "props":{"module":"owner_admin","surface_kind":"settings","composition":"owner_admin_settings_control_v2"},
  "children":[
    {
      "id":"owner_settings_header",
      "type":"PanelHeader",
      "props":{"eyebrow":"Admin Console","title":"Settings","subtitle":"Manage tenant-scoped governed configuration. Secret credentials remain outside this surface."}
    },
    {
      "id":"owner_settings_layout",
      "type":"SplitLayout",
      "props":{"columns":2,"min_column_width":"340px"},
      "children":[
        {
          "id":"owner_settings_table",
          "type":"ContractTablePanel",
          "props":{
            "eyebrow":"Governed settings",
            "title":"Configuration keys",
            "list_contract":{"method":"GET","endpoint":"/api/eip/owner-admin/control/settings"},
            "row_id_key":"id",
            "empty_message":"No tenant settings are currently defined.",
            "pagination":{"enabled":false},
            "selection":{
              "target":"admin_setting",
              "key":"id",
              "auto_select_first":true,
              "refresh_selected_record":true,
              "clear_on_new":true,
              "new_action":{"label":"New setting","requires_any_permission":["OWNER_ADMIN_SETTINGS_WRITE"]}
            },
            "columns":[
              {"key":"setting_key","label":"Setting","format":"text"},
              {"key":"setting_status","label":"Status","format":"text"},
              {"key":"updated_at","label":"Updated","format":"datetime"}
            ]
          }
        },
        {
          "id":"owner_settings_editor",
          "type":"ContractFlowStepEditor",
          "props":{
            "record_selection_target":"admin_setting",
            "record_key":"id",
            "record_path_param":"id",
            "update_contract":{"method":"PATCH","endpoint":"/api/eip/owner-admin/control/settings/:id"},
            "update_item_path":"setting",
            "create_when_unselected":true,
            "create_contract":{"method":"POST","endpoint":"/api/eip/owner-admin/control/settings"},
            "create_item_path":"setting",
            "permissions_any":["OWNER_ADMIN_SETTINGS_WRITE"],
            "create_mode_title":"New setting",
            "create_mode_message":"Create a tenant-scoped JSON configuration record.",
            "create_label":"Save setting",
            "save_label":"Save changes",
            "fields":[
              {"key":"setting_key","path":"setting_key","label":"Setting key","required":true,"immutable_after_create":true},
              {"key":"setting_value","path":"setting_value","label":"Value","type":"json_object","rows":12,"required":true},
              {"key":"setting_status","path":"setting_status","label":"Status","type":"select","default_value":"active","options":[{"value":"active","label":"Active"},{"value":"disabled","label":"Disabled"},{"value":"deprecated","label":"Deprecated"}]}
            ]
          }
        }
      ]
    }
  ]
}
$json$::jsonb,
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0069"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_settings';

-- ---------------------------------------------------------------------------
-- Audit — durable redacted privileged control-plane evidence.
-- ---------------------------------------------------------------------------
UPDATE eip_core.ui_surface
SET tree = $json$
{
  "type":"SurfaceRoot",
  "props":{"module":"owner_admin","surface_kind":"audit","composition":"owner_admin_audit_control_v2"},
  "children":[
    {
      "id":"owner_audit_header",
      "type":"PanelHeader",
      "props":{"eyebrow":"Admin Console","title":"Audit","subtitle":"Review redacted privileged administration events for this organisation."}
    },
    {
      "id":"owner_audit_events",
      "type":"ContractTablePanel",
      "props":{
        "eyebrow":"Control-plane evidence",
        "title":"Recent admin events",
        "list_contract":{"method":"GET","endpoint":"/api/eip/owner-admin/control/audit?limit=100"},
        "row_id_key":"id",
        "empty_message":"No privileged administration events are recorded yet.",
        "pagination":{"enabled":false},
        "columns":[
          {"key":"event_code","label":"Event","format":"text"},
          {"key":"category","label":"Category","format":"text"},
          {"key":"severity","label":"Severity","format":"text"},
          {"key":"outcome","label":"Outcome","format":"text"},
          {"key":"actor_login","label":"Actor","format":"text"},
          {"key":"summary","label":"Summary","format":"text"},
          {"key":"occurred_at","label":"Occurred","format":"datetime"}
        ]
      }
    }
  ]
}
$json$::jsonb,
    attrs = jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0069"'::jsonb, true),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_audit';

-- ---------------------------------------------------------------------------
-- Data Explorer — metadata/schema catalogue only; never arbitrary row browsing.
-- ---------------------------------------------------------------------------
UPDATE eip_core.ui_surface
SET title = 'Data Catalogue',
    tree = $json$
{
  "type":"SurfaceRoot",
  "props":{"module":"owner_admin","surface_kind":"data_explorer","composition":"owner_admin_schema_catalogue_v2"},
  "children":[
    {
      "id":"owner_data_header",
      "type":"PanelHeader",
      "props":{"eyebrow":"Admin Console","title":"Data Catalogue","subtitle":"Inspect the governed V2 schema catalogue without exposing business rows or secret values."}
    },
    {
      "id":"owner_data_catalogue",
      "type":"ContractTablePanel",
      "props":{
        "eyebrow":"Schema metadata",
        "title":"Tables and columns",
        "list_contract":{"method":"GET","endpoint":"/api/eip/owner-admin/control/schema-catalog"},
        "row_id_key":"table_name",
        "empty_message":"No schema metadata is available.",
        "pagination":{"enabled":false},
        "columns":[
          {"key":"table_schema","label":"Schema","format":"text"},
          {"key":"table_name","label":"Table","format":"text"},
          {"key":"column_count","label":"Columns","format":"number"},
          {"key":"columns","label":"Structure","format":"text"}
        ]
      }
    },
    {
      "id":"owner_data_boundary",
      "type":"NoticePanel",
      "props":{"eyebrow":"Governance boundary","title":"Schema inspection only","message":"This catalogue exposes structure, not arbitrary table rows. Tenant data, credentials and secret material remain behind their dedicated governed APIs."}
    }
  ]
}
$json$::jsonb,
    attrs = jsonb_set(
      jsonb_set(
        jsonb_set(COALESCE(attrs, '{}'::jsonb), '{source}', '"v2_0069"'::jsonb, true),
        '{surface_nav,label}', to_jsonb('Data Catalogue'::text), true
      ),
      '{surface_nav,hint}', to_jsonb('Governed schema metadata; no arbitrary row browsing'::text), true
    ),
    updated_at = now()
WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_data_explorer';

-- Closure assertions: core control surfaces must be real, metadata-driven,
-- server-tenant-scoped contracts and must not carry raw browser tenant UUIDs.
DO $$
DECLARE
  code text;
  surface_tree jsonb;
BEGIN
  FOREACH code IN ARRAY ARRAY[
    'owner_tenant_requests',
    'owner_users_roles',
    'owner_security',
    'owner_settings',
    'owner_audit',
    'owner_data_explorer'
  ]
  LOOP
    SELECT tree INTO surface_tree
    FROM eip_core.ui_surface
    WHERE tenant_id IS NULL AND version = 1 AND eip_core.ui_surface.code = code
    LIMIT 1;

    IF surface_tree IS NULL THEN
      RAISE EXCEPTION 'v2_0069 missing Owner Admin surface %', code;
    END IF;
    IF surface_tree::text LIKE '%"tenant_id"%' THEN
      RAISE EXCEPTION 'v2_0069 raw browser tenant authority detected in surface %', code;
    END IF;
    IF NOT (surface_tree::text LIKE '%/api/eip/owner-admin/control/%') THEN
      RAISE EXCEPTION 'v2_0069 surface % is not bound to governed control contracts', code;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM eip_core.ui_surface
    WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_tenant_requests'
      AND tree::text LIKE '%/tenant-requests/:id/approve%'
      AND tree::text LIKE '%/tenant-requests/:id/reject%'
      AND tree::text LIKE '%/tenant-requests/:id/resend%'
  ) THEN
    RAISE EXCEPTION 'v2_0069 tenant request controls incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM eip_core.ui_surface
    WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_users_roles'
      AND tree::text LIKE '%/control/users/:id%'
      AND tree::text LIKE '%OWNER_ADMIN_ACCESS_WRITE%'
  ) THEN
    RAISE EXCEPTION 'v2_0069 Users & Access controls incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM eip_core.ui_surface
    WHERE tenant_id IS NULL AND version = 1 AND code = 'owner_security'
      AND tree::text LIKE '%/control/security/sessions/:id/revoke%'
      AND tree::text LIKE '%/control/security/devices/:id%'
  ) THEN
    RAISE EXCEPTION 'v2_0069 Security controls incomplete';
  END IF;
END
$$;

COMMIT;
