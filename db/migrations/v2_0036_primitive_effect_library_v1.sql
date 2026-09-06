BEGIN;

-- EIP Core V2 — Effect Library Primitive V1 rationalisation.
-- Forward-only migration. Historical effect seed migrations remain immutable.
--
-- Governing boundary:
-- Process -> Task semantics -> Macro -> governed reasoning -> Object_Effect primitive
-- -> explicit kernel object family/runtime parameters -> finite handler -> governed mutation.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.dropdown_list
    WHERE code = 'PROCESS_EFFECT_TYPE'
      AND tenant_id IS NULL
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'PROCESS_EFFECT_TYPE_LIST_MISSING';
  END IF;
END $$;

-- Business-semantic Effects are forbidden from the primitive library. Do not silently
-- retire one while an active process still references it: migrate the Process/Macro first.
DO $$
DECLARE
  v_conflict_count bigint;
BEGIN
  SELECT count(*)
  INTO v_conflict_count
  FROM eip_core.process_def pd
  WHERE pd.is_active = true
    AND pd.graph::text ~ '"type"\s*:\s*"(INVENTORY_MOVE|INVENTORY_CONSUME|INVENTORY_PRODUCE|INVENTORY_CONVERT|VARIANT_INVENTORY_VALIDATE)"';

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION
      'PRIMITIVE_EFFECT_TAXONOMY_CONFLICT: % active process definition(s) still reference retired inventory/business Effects',
      v_conflict_count;
  END IF;
END $$;

-- JSON_MERGE is a broad multi-target mutation primitive that duplicates explicit
-- object-family patch semantics. Retire only when no active process still depends on it.
DO $$
DECLARE
  v_conflict_count bigint;
BEGIN
  SELECT count(*)
  INTO v_conflict_count
  FROM eip_core.process_def pd
  WHERE pd.is_active = true
    AND pd.graph::text ~ '"type"\s*:\s*"(JSON_MERGE|ATTRS_MERGE)"';

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION
      'PRIMITIVE_EFFECT_JSON_MERGE_CONFLICT: % active process definition(s) still reference JSON_MERGE/ATTRS_MERGE',
      v_conflict_count;
  END IF;
END $$;

-- Correct catalogue applicability: Effects are Macro-owned execution bundles, never
-- transition-local hidden Effects.
UPDATE eip_core.dropdown_list
SET attrs = jsonb_set(
      COALESCE(attrs, '{}'::jsonb) || '{"ui":{}}'::jsonb,
      '{ui,applies_to}',
      '["process_def.graph.macros.*.effects"]'::jsonb,
      true
    ) || jsonb_build_object(
      'primitive_v1_locked', true,
      'primitive_v1_document', 'docs/architecture/EFFECT_LIBRARY_PRIMITIVE_V1.md'
    ),
    updated_at = now()
WHERE code = 'PROCESS_EFFECT_TYPE'
  AND tenant_id IS NULL
  AND is_active = true;

-- Canonical public Object_Effect identities. The current finite runtime still uses
-- historical executable codes internally; runtime_compatibility_code is explicit and
-- temporary. Business metadata must use the public canonical code from now on.
WITH effect_list AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND tenant_id IS NULL
    AND is_active = true
  ORDER BY version DESC
  LIMIT 1
), canonical(code, label, sort_order, runtime_code, runtime_handler, object_family, required_fields, allowed_targets) AS (
  VALUES
    ('SERVICE_OBJECT_CREATE',           'Service Object Create',           10, 'CHILD_SERVICE_OBJECT_CREATE', 'childServiceObjectCreate', 'service_object', '[]'::jsonb,                       '[]'::jsonb),
    ('SERVICE_OBJECT_PATCH',            'Service Object Patch',            20, 'SO_UPDATE',                   'serviceObjectUpdate',      'service_object', '["patches"]'::jsonb,              '["service_object"]'::jsonb),
    ('SERVICE_OBJECT_STATE_TRANSITION', 'Service Object State Transition', 30, 'STATUS_SET',                  'statusSet',                'service_object', '["to"]'::jsonb,                   '["service_object"]'::jsonb),
    ('TASK_CREATE',                     'Task Create',                     40, 'TASK_CREATE',                 'taskCreate',               'task',           '["task_type"]'::jsonb,            '["task"]'::jsonb),
    ('TASK_PATCH',                      'Task Patch',                      50, 'TASK_UPDATE',                 'taskUpdate',               'task',           '["task_id"]'::jsonb,              '["task"]'::jsonb),
    ('TASK_STATE_TRANSITION',           'Task State Transition',           60, 'TASK_UPDATE',                 'taskUpdate',               'task',           '["task_id","to"]'::jsonb,       '["task"]'::jsonb),
    ('LINK_CREATE',                     'Link Create',                     70, 'LINK_CREATE',                 'linkCreate',               'object_link',    '["src_kind","src_id","dst_kind","dst_id","relation_type"]'::jsonb, '["object_link"]'::jsonb),
    ('LINK_REMOVE',                     'Link Remove',                     80, 'LINK_REMOVE',                 'linkRemove',               'object_link',    '["src_kind","src_id","dst_kind","dst_id","relation_type"]'::jsonb, '["object_link"]'::jsonb),
    ('INFO_RECORD_CREATE',              'Info Record Create',              90, 'INFO_RECORD_WRITE',           'infoRecordWrite',          'info_record',    '["record_type"]'::jsonb,          '["info_record"]'::jsonb),
    ('PROCESS_START',                   'Process Start',                  100, 'INSTANCE_START',              'instanceStart',            'process_instance','[]'::jsonb,                      '["process_instance"]'::jsonb),
    ('ACCESS_GRANT_CREATE',             'Access Grant Create',            110, 'ACCESS_GRANT_CREATE',         'accessGrantCreate',        'access_grant',   '["grant_type"]'::jsonb,           '["access_grant"]'::jsonb),
    ('ACCESS_GRANT_PATCH',              'Access Grant Patch',             120, 'ACCESS_GRANT_UPDATE',         'accessGrantUpdate',        'access_grant',   '[]'::jsonb,                       '["access_grant"]'::jsonb)
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT
  effect_list.id,
  canonical.code,
  canonical.label,
  canonical.sort_order,
  true,
  jsonb_build_object(
    'canonical_public_effect_code', canonical.code,
    'canonical_effect_code', canonical.runtime_code,
    'runtime_compatibility_code', canonical.runtime_code,
    'runtime_handler', canonical.runtime_handler,
    'object_family', canonical.object_family,
    'semantic_class', CASE
      WHEN canonical.object_family = 'access_grant' THEN 'security_kernel_effect'
      ELSE 'primitive_object_effect'
    END,
    'required_fields', canonical.required_fields,
    'allowed_targets', canonical.allowed_targets,
    'primitive_v1', true,
    'deprecated', false
  ) || CASE
    WHEN canonical.code = 'SERVICE_OBJECT_PATCH' THEN jsonb_build_object(
      'operations', jsonb_build_array('SET', 'REMOVE'),
      'bounded_patch', true,
      'mutation_scope', jsonb_build_array('attrs'),
      'calculated_values_allowed', true,
      'reasoning_inside_handler', false
    )
    WHEN canonical.code = 'TASK_CREATE' THEN jsonb_build_object(
      'resolved_temporal_fields', jsonb_build_array('due_at'),
      'deprecated_convenience_fields', jsonb_build_array('due_in_days')
    )
    ELSE '{}'::jsonb
  END
FROM effect_list
CROSS JOIN canonical
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = true,
    attrs = EXCLUDED.attrs,
    updated_at = now();

-- Historical executable identities remain temporarily active only so the current finite
-- code dispatcher can execute the canonical public primitives above. They are hidden,
-- deprecated and explicitly denied authority as public primitive identities.
WITH effect_list AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND tenant_id IS NULL
    AND is_active = true
  ORDER BY version DESC
  LIMIT 1
), aliases(code, replacement) AS (
  VALUES
    ('CHILD_SERVICE_OBJECT_CREATE', 'SERVICE_OBJECT_CREATE'),
    ('STATUS_SET',                  'SERVICE_OBJECT_STATE_TRANSITION'),
    ('SO_UPDATE',                   'SERVICE_OBJECT_PATCH'),
    ('TASK_UPDATE',                 'TASK_PATCH'),
    ('INFO_RECORD_WRITE',           'INFO_RECORD_CREATE'),
    ('INSTANCE_START',              'PROCESS_START'),
    ('ACCESS_GRANT_UPDATE',         'ACCESS_GRANT_PATCH'),
    ('SO_CREATE',                   'SERVICE_OBJECT_CREATE'),
    ('SO_STATUS',                   'SERVICE_OBJECT_STATE_TRANSITION'),
    ('TASK_STATUS',                 'TASK_STATE_TRANSITION'),
    ('LINK',                        'LINK_CREATE')
)
UPDATE eip_core.dropdown_value dv
SET attrs = COALESCE(dv.attrs, '{}'::jsonb) || jsonb_build_object(
      'deprecated', true,
      'ui_hidden', true,
      'compatibility_alias_only', true,
      'canonical_public_effect_code', aliases.replacement,
      'replacement_effect_code', aliases.replacement,
      'public_primitive_authority', false
    ),
    updated_at = now()
FROM effect_list, aliases
WHERE dv.list_id = effect_list.id
  AND dv.code = aliases.code;

-- Broad duplicate mutation primitive and its alias are retired.
WITH effect_list AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND tenant_id IS NULL
    AND is_active = true
  ORDER BY version DESC
  LIMIT 1
)
UPDATE eip_core.dropdown_value dv
SET is_active = false,
    attrs = COALESCE(dv.attrs, '{}'::jsonb) || jsonb_build_object(
      'deprecated', true,
      'ui_hidden', true,
      'removed_from_primitive_v1', true,
      'replacement_effect_code', 'SERVICE_OBJECT_PATCH',
      'retired_by_migration', 'v2_0036'
    ),
    updated_at = now()
FROM effect_list
WHERE dv.list_id = effect_list.id
  AND dv.code IN ('JSON_MERGE', 'ATTRS_MERGE');

-- Inventory/variant operations are business semantics, not primitive Object_Effects.
WITH effect_list AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND tenant_id IS NULL
    AND is_active = true
  ORDER BY version DESC
  LIMIT 1
)
UPDATE eip_core.dropdown_value dv
SET is_active = false,
    attrs = COALESCE(dv.attrs, '{}'::jsonb) || jsonb_build_object(
      'deprecated', true,
      'ui_hidden', true,
      'forbidden_as_primitive', true,
      'replacement_layer', 'process_macro_reasoning',
      'retired_by_migration', 'v2_0036'
    ),
    updated_at = now()
FROM effect_list
WHERE dv.list_id = effect_list.id
  AND dv.code IN (
    'INVENTORY_MOVE',
    'INVENTORY_CONSUME',
    'INVENTORY_PRODUCE',
    'INVENTORY_CONVERT',
    'VARIANT_INVENTORY_VALIDATE'
  );

-- HTTP_REQUEST remains a generic governed integration capability for compatibility,
-- but is explicitly outside Object_Effect Primitive V1. API_CALL remains only a deprecated alias.
WITH effect_list AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND tenant_id IS NULL
    AND is_active = true
  ORDER BY version DESC
  LIMIT 1
)
UPDATE eip_core.dropdown_value dv
SET attrs = COALESCE(dv.attrs, '{}'::jsonb) || CASE dv.code
      WHEN 'HTTP_REQUEST' THEN jsonb_build_object(
        'semantic_class', 'integration_capability',
        'primitive_v1', false,
        'object_effect', false,
        'separation_required', 'integration_result_should_be_persisted_by_object_effect'
      )
      ELSE jsonb_build_object(
        'deprecated', true,
        'ui_hidden', true,
        'compatibility_alias_only', true,
        'replacement_effect_code', 'HTTP_REQUEST',
        'public_primitive_authority', false
      )
    END,
    updated_at = now()
FROM effect_list
WHERE dv.list_id = effect_list.id
  AND dv.code IN ('HTTP_REQUEST', 'API_CALL');

COMMIT;
