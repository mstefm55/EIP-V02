BEGIN;

WITH module_config AS (
  SELECT *
  FROM (
    VALUES
      (
        'owner_dashboard',
        'dashboard',
        'Dashboard',
        'Monitor owner-admin platform posture, pending actions, and tenant health checkpoints.',
        'metric',
        'Metric',
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb
      ),
      (
        'owner_tenant_requests',
        'tenant_requests',
        'Tenant Requests',
        'Review onboarding intake requests and track approval progression for each applicant.',
        'onboarding_stage',
        'Stage',
        $$[
          {"key":"applicant_name","label":"Applicant Name","type":"text"},
          {"key":"applicant_email","label":"Applicant Email","type":"text"},
          {"key":"applicant_country","label":"Applicant Country","type":"text"},
          {"key":"onboarding_stage","label":"Onboarding Stage","type":"text"}
        ]$$::jsonb,
        $$[
          {"field":"applicant_name","from":"attrs.applicant_name"},
          {"field":"applicant_email","from":"attrs.applicant_email"},
          {"field":"applicant_country","from":"attrs.applicant_country"},
          {"field":"onboarding_stage","from":"attrs.onboarding_stage"}
        ]$$::jsonb,
        $$[
          {"target":"applicant_name","from":"$draft.applicant_name","omit_empty":true},
          {"target":"applicant_email","from":"$draft.applicant_email","omit_empty":true},
          {"target":"applicant_country","from":"$draft.applicant_country","omit_empty":true},
          {"target":"onboarding_stage","from":"$draft.onboarding_stage","omit_empty":true}
        ]$$::jsonb
      ),
      (
        'owner_connections',
        'connections',
        'Connections',
        'Configure gateway connection profiles for tenant websites, APIs, and external resources.',
        'connection_kind',
        'Kind',
        $$[
          {"key":"connection_kind","label":"Connection Kind","type":"text"},
          {"key":"frontend_url","label":"Frontend URL","type":"text"},
          {"key":"portal_url","label":"Portal URL","type":"text"},
          {"key":"direction","label":"Direction","type":"text"},
          {"key":"environment","label":"Environment","type":"text"},
          {"key":"gateway_route","label":"Gateway Route","type":"text"},
          {"key":"api_key_label","label":"API Key Label","type":"text"}
        ]$$::jsonb,
        $$[
          {"field":"connection_kind","from":"attrs.connection_kind"},
          {"field":"frontend_url","from":"attrs.frontend_url"},
          {"field":"portal_url","from":"attrs.portal_url"},
          {"field":"direction","from":"attrs.direction"},
          {"field":"environment","from":"attrs.environment"},
          {"field":"gateway_route","from":"attrs.gateway_route"},
          {"field":"api_key_label","from":"attrs.api_key_label"}
        ]$$::jsonb,
        $$[
          {"target":"connection_kind","from":"$draft.connection_kind","omit_empty":true},
          {"target":"frontend_url","from":"$draft.frontend_url","omit_empty":true},
          {"target":"portal_url","from":"$draft.portal_url","omit_empty":true},
          {"target":"direction","from":"$draft.direction","omit_empty":true},
          {"target":"environment","from":"$draft.environment","omit_empty":true},
          {"target":"gateway_route","from":"$draft.gateway_route","omit_empty":true},
          {"target":"api_key_label","from":"$draft.api_key_label","omit_empty":true}
        ]$$::jsonb
      ),
      (
        'owner_tasks_follow_up',
        'tasks_follow_up',
        'Tasks & Follow-up',
        'Track owner-admin follow-up actions, due dates, and execution ownership.',
        'priority',
        'Priority',
        $$[
          {"key":"priority","label":"Priority","type":"text"},
          {"key":"due_date","label":"Due Date","type":"text"},
          {"key":"action_owner","label":"Action Owner","type":"text"}
        ]$$::jsonb,
        $$[
          {"field":"priority","from":"attrs.priority"},
          {"field":"due_date","from":"attrs.due_date"},
          {"field":"action_owner","from":"attrs.action_owner"}
        ]$$::jsonb,
        $$[
          {"target":"priority","from":"$draft.priority","omit_empty":true},
          {"target":"due_date","from":"$draft.due_date","omit_empty":true},
          {"target":"action_owner","from":"$draft.action_owner","omit_empty":true}
        ]$$::jsonb
      ),
      (
        'owner_users_roles',
        'users_roles',
        'Users & Roles',
        'Maintain identity access assignments, role mappings, and owner-admin user governance.',
        'role_code',
        'Role',
        $$[
          {"key":"principal_login","label":"Principal Login","type":"text"},
          {"key":"role_code","label":"Role Code","type":"text"},
          {"key":"access_scope","label":"Access Scope","type":"text"},
          {"key":"last_seen_at","label":"Last Seen","type":"text"}
        ]$$::jsonb,
        $$[
          {"field":"principal_login","from":"attrs.principal_login"},
          {"field":"role_code","from":"attrs.role_code"},
          {"field":"access_scope","from":"attrs.access_scope"},
          {"field":"last_seen_at","from":"attrs.last_seen_at"}
        ]$$::jsonb,
        $$[
          {"target":"principal_login","from":"$draft.principal_login","omit_empty":true},
          {"target":"role_code","from":"$draft.role_code","omit_empty":true},
          {"target":"access_scope","from":"$draft.access_scope","omit_empty":true},
          {"target":"last_seen_at","from":"$draft.last_seen_at","omit_empty":true}
        ]$$::jsonb
      ),
      (
        'owner_portfolios',
        'portfolios',
        'Portfolios',
        'Manage owner-admin portfolio groups and monitor delivery outcomes per portfolio.',
        'portfolio_domain',
        'Domain',
        $$[
          {"key":"portfolio_domain","label":"Portfolio Domain","type":"text"},
          {"key":"delivery_owner","label":"Delivery Owner","type":"text"}
        ]$$::jsonb,
        $$[
          {"field":"portfolio_domain","from":"attrs.portfolio_domain"},
          {"field":"delivery_owner","from":"attrs.delivery_owner"}
        ]$$::jsonb,
        $$[
          {"target":"portfolio_domain","from":"$draft.portfolio_domain","omit_empty":true},
          {"target":"delivery_owner","from":"$draft.delivery_owner","omit_empty":true}
        ]$$::jsonb
      ),
      (
        'owner_templates',
        'templates',
        'Templates',
        'Maintain reusable templates used for tenant onboarding and owner-admin operations.',
        'template_scope',
        'Scope',
        $$[
          {"key":"template_scope","label":"Template Scope","type":"text"},
          {"key":"template_version","label":"Template Version","type":"text"}
        ]$$::jsonb,
        $$[
          {"field":"template_scope","from":"attrs.template_scope"},
          {"field":"template_version","from":"attrs.template_version"}
        ]$$::jsonb,
        $$[
          {"target":"template_scope","from":"$draft.template_scope","omit_empty":true},
          {"target":"template_version","from":"$draft.template_version","omit_empty":true}
        ]$$::jsonb
      ),
      (
        'owner_security',
        'security',
        'Security',
        'Track security control coverage, severity, and remediation evidence records.',
        'severity',
        'Severity',
        $$[
          {"key":"control_code","label":"Control Code","type":"text"},
          {"key":"severity","label":"Severity","type":"text"},
          {"key":"evidence_ref","label":"Evidence Reference","type":"text"}
        ]$$::jsonb,
        $$[
          {"field":"control_code","from":"attrs.control_code"},
          {"field":"severity","from":"attrs.severity"},
          {"field":"evidence_ref","from":"attrs.evidence_ref"}
        ]$$::jsonb,
        $$[
          {"target":"control_code","from":"$draft.control_code","omit_empty":true},
          {"target":"severity","from":"$draft.severity","omit_empty":true},
          {"target":"evidence_ref","from":"$draft.evidence_ref","omit_empty":true}
        ]$$::jsonb
      ),
      (
        'owner_audit',
        'audit',
        'Audit',
        'Review owner-admin audit events, actions, and compliance trace evidence.',
        'event_type',
        'Event Type',
        $$[
          {"key":"event_type","label":"Event Type","type":"text"},
          {"key":"actor","label":"Actor","type":"text"},
          {"key":"occurred_at","label":"Occurred At","type":"text"}
        ]$$::jsonb,
        $$[
          {"field":"event_type","from":"attrs.event_type"},
          {"field":"actor","from":"attrs.actor"},
          {"field":"occurred_at","from":"attrs.occurred_at"}
        ]$$::jsonb,
        $$[
          {"target":"event_type","from":"$draft.event_type","omit_empty":true},
          {"target":"actor","from":"$draft.actor","omit_empty":true},
          {"target":"occurred_at","from":"$draft.occurred_at","omit_empty":true}
        ]$$::jsonb
      ),
      (
        'owner_data_explorer',
        'data_explorer',
        'Data Explorer',
        'Browse governed data checkpoints and maintain catalog notes per dataset.',
        'data_domain',
        'Data Domain',
        $$[
          {"key":"data_domain","label":"Data Domain","type":"text"},
          {"key":"sensitivity","label":"Sensitivity","type":"text"},
          {"key":"refreshed_at","label":"Refreshed At","type":"text"}
        ]$$::jsonb,
        $$[
          {"field":"data_domain","from":"attrs.data_domain"},
          {"field":"sensitivity","from":"attrs.sensitivity"},
          {"field":"refreshed_at","from":"attrs.refreshed_at"}
        ]$$::jsonb,
        $$[
          {"target":"data_domain","from":"$draft.data_domain","omit_empty":true},
          {"target":"sensitivity","from":"$draft.sensitivity","omit_empty":true},
          {"target":"refreshed_at","from":"$draft.refreshed_at","omit_empty":true}
        ]$$::jsonb
      ),
      (
        'owner_integrations',
        'integrations',
        'Integrations',
        'Govern integration provider onboarding and monitor integration readiness.',
        'provider',
        'Provider',
        $$[
          {"key":"provider","label":"Provider","type":"text"},
          {"key":"direction","label":"Direction","type":"text"},
          {"key":"endpoint","label":"Endpoint","type":"text"}
        ]$$::jsonb,
        $$[
          {"field":"provider","from":"attrs.provider"},
          {"field":"direction","from":"attrs.direction"},
          {"field":"endpoint","from":"attrs.endpoint"}
        ]$$::jsonb,
        $$[
          {"target":"provider","from":"$draft.provider","omit_empty":true},
          {"target":"direction","from":"$draft.direction","omit_empty":true},
          {"target":"endpoint","from":"$draft.endpoint","omit_empty":true}
        ]$$::jsonb
      ),
      (
        'owner_reports',
        'reports',
        'Reports',
        'Manage reporting packs, schedule cadence, and track latest report executions.',
        'cadence',
        'Cadence',
        $$[
          {"key":"cadence","label":"Cadence","type":"text"},
          {"key":"last_run_at","label":"Last Run At","type":"text"},
          {"key":"report_scope","label":"Report Scope","type":"text"}
        ]$$::jsonb,
        $$[
          {"field":"cadence","from":"attrs.cadence"},
          {"field":"last_run_at","from":"attrs.last_run_at"},
          {"field":"report_scope","from":"attrs.report_scope"}
        ]$$::jsonb,
        $$[
          {"target":"cadence","from":"$draft.cadence","omit_empty":true},
          {"target":"last_run_at","from":"$draft.last_run_at","omit_empty":true},
          {"target":"report_scope","from":"$draft.report_scope","omit_empty":true}
        ]$$::jsonb
      ),
      (
        'owner_settings',
        'settings',
        'Settings',
        'Maintain owner-admin platform settings and controlled tenant-scoped override preferences.',
        'setting_scope',
        'Scope',
        $$[
          {"key":"setting_scope","label":"Setting Scope","type":"text"},
          {"key":"setting_value","label":"Setting Value","type":"textarea","rows":4}
        ]$$::jsonb,
        $$[
          {"field":"setting_scope","from":"attrs.setting_scope"},
          {"field":"setting_value","from":"attrs.setting_value"}
        ]$$::jsonb,
        $$[
          {"target":"setting_scope","from":"$draft.setting_scope","omit_empty":true},
          {"target":"setting_value","from":"$draft.setting_value","omit_empty":true}
        ]$$::jsonb
      )
  ) AS t(
    surface_code,
    module_key,
    title,
    subtitle,
    module_column_key,
    module_column_label,
    extra_fields,
    extra_item_mapping,
    extra_attr_merges
  )
),
render_config AS (
  SELECT
    surface_code,
    module_key,
    title,
    subtitle,
    (
      jsonb_build_array(
        jsonb_build_object('key', 'title', 'label', 'Title', 'format', 'text'),
        jsonb_build_object('key', 'code', 'label', 'Code', 'format', 'text'),
        jsonb_build_object('key', 'status', 'label', 'Status', 'format', 'text'),
        jsonb_build_object('key', 'owner', 'label', 'Owner', 'format', 'text'),
        jsonb_build_object('key', 'updated_at', 'label', 'Updated', 'format', 'datetime')
      )
      || CASE
           WHEN module_column_key IS NULL OR module_column_label IS NULL THEN '[]'::jsonb
           ELSE jsonb_build_array(
             jsonb_build_object(
               'key', module_column_key,
               'label', module_column_label,
               'format', 'text'
             )
           )
         END
    ) AS columns_json,
    (
      jsonb_build_array(
        jsonb_build_object('key', 'title', 'label', 'Title', 'type', 'text', 'required', true),
        jsonb_build_object('key', 'code', 'label', 'Code', 'type', 'text', 'required', true),
        jsonb_build_object('key', 'status', 'label', 'Status', 'type', 'text', 'required', true),
        jsonb_build_object('key', 'owner', 'label', 'Owner', 'type', 'text'),
        jsonb_build_object('key', 'summary', 'label', 'Summary', 'type', 'textarea', 'rows', 3),
        jsonb_build_object('key', 'notes', 'label', 'Notes', 'type', 'textarea', 'rows', 5),
        jsonb_build_object('key', 'is_active', 'label', 'Enabled', 'type', 'checkbox')
      )
      || extra_fields
    ) AS fields_json,
    (
      jsonb_build_array(
        jsonb_build_object('field', 'title', 'from', 'title'),
        jsonb_build_object('field', 'code', 'from', 'code'),
        jsonb_build_object('field', 'status', 'from', 'status'),
        jsonb_build_object('field', 'owner', 'from', 'attrs.owner'),
        jsonb_build_object('field', 'summary', 'from', 'attrs.summary'),
        jsonb_build_object('field', 'notes', 'from', 'attrs.notes'),
        jsonb_build_object('field', 'is_active', 'from', 'attrs.is_active', 'transform', 'bool', 'default_value', true)
      )
      || extra_item_mapping
    ) AS item_mapping_json,
    (
      jsonb_build_array(
        jsonb_build_object('target', 'owner', 'from', '$draft.owner', 'omit_empty', true),
        jsonb_build_object('target', 'summary', 'from', '$draft.summary', 'omit_empty', true),
        jsonb_build_object('target', 'notes', 'from', '$draft.notes', 'omit_empty', true),
        jsonb_build_object('target', 'is_active', 'from', '$draft.is_active', 'transform', 'bool')
      )
      || extra_attr_merges
    ) AS attr_merges_json
  FROM module_config
)
UPDATE eip_core.ui_surface AS surface
SET tree = jsonb_build_object(
      'type', 'SurfaceRoot',
      'props', jsonb_build_object(
        'module', 'owner_admin',
        'surface_kind', rc.module_key
      ),
      'children', jsonb_build_array(
        jsonb_build_object(
          'id', rc.surface_code || '_header',
          'type', 'PanelHeader',
          'props', jsonb_build_object(
            'eyebrow', 'Owner Admin',
            'title', rc.title,
            'subtitle', rc.subtitle
          )
        ),
        jsonb_build_object(
          'id', rc.surface_code || '_editor',
          'type', 'ContractRecordEditor',
          'props', jsonb_build_object(
            'title', rc.title || ' Detail',
            'eyebrow', 'Configuration',
            'selection_required_path', 'surfaceProps.surface_kind',
            'selection_required_message', 'Select a workspace to load records.',
            'permissions_any', jsonb_build_array('PROCESS_DEF_WRITE', 'CRM_PROCESS_DEF_WRITE'),
            'read_only_message', 'Your session is read-only for this workspace.',
            'list_contract', jsonb_build_object(
              'method', 'GET',
              'endpoint', '/api/eip/owner-admin/modules/' || rc.module_key || '/records'
            ),
            'create_contract', jsonb_build_object(
              'method', 'POST',
              'endpoint', '/api/eip/owner-admin/modules/' || rc.module_key || '/records'
            ),
            'update_contract', jsonb_build_object(
              'method', 'PATCH',
              'endpoint', '/api/eip/owner-admin/modules/' || rc.module_key || '/records/:id'
            ),
            'list_view', jsonb_build_object(
              'id_key', 'id',
              'title_field', 'title',
              'subtitle_field', 'code',
              'empty_subtitle', '-',
              'empty_list_message', 'No records yet. Choose New to create one.',
              'empty_editor_message', 'Select a record to view details.'
            ),
            'fields', rc.fields_json,
            'item_mapping', rc.item_mapping_json,
            'save_payload', jsonb_build_object(
              'template', jsonb_build_object(
                'title', '$draft.title',
                'code', '$draft.code',
                'status', '$draft.status'
              ),
              'attrs', jsonb_build_object(
                'target', 'attrs',
                'merges', rc.attr_merges_json
              )
            ),
            'deactivate_payload', jsonb_build_object(
              'status', 'inactive',
              'attrs', jsonb_build_object('is_active', false)
            ),
            'actions', jsonb_build_object(
              'new_label', 'New',
              'refresh_label', 'Refresh',
              'save_label', 'Save',
              'save_busy_label', 'Saving...',
              'deactivate_label', 'Deactivate'
            )
          )
        )
      )
    ),
    attrs = jsonb_set(
      jsonb_set(
        COALESCE(surface.attrs, '{}'::jsonb),
        '{source}',
        to_jsonb('v2_0031'::text),
        true
      ),
      '{surface_kind}',
      to_jsonb(rc.module_key::text),
      true
    ),
    updated_at = now()
FROM render_config AS rc
WHERE surface.tenant_id IS NULL
  AND surface.version = 1
  AND surface.code = rc.surface_code;

COMMIT;
