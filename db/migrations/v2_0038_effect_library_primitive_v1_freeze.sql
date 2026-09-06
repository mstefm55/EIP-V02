BEGIN;

-- EIP Core V2 — Effect Library Primitive V1 final freeze.
-- Forward-only correction following v2_0036/v2_0037.
-- No schema expansion and no business-specific Effect admission.
--
-- Final simulation-driven corrections:
--   1) LINK_PATCH is admitted as a bounded Object Link attrs mutation.
--   2) SERVICE_OBJECT_PATCH owns bounded non-lifecycle Service Object mutation
--      across code/title/owner_agent_id plus bounded attrs path patches.
--      Status remains exclusively SERVICE_OBJECT_STATE_TRANSITION.

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

WITH global_list AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND tenant_id IS NULL
    AND is_active = true
  ORDER BY version DESC
  LIMIT 1
)
UPDATE eip_core.dropdown_value dv
SET label = 'Service Object Patch',
    is_active = true,
    attrs = jsonb_build_object(
      'canonical_public_effect_code', 'SERVICE_OBJECT_PATCH',
      'canonical_effect_code', 'SERVICE_OBJECT_PATCH',
      'runtime_handler', 'serviceObjectPatch',
      'object_family', 'service_object',
      'semantic_class', 'primitive_object_effect',
      'required_fields', '[]'::jsonb,
      'required_any', '[["patches","code","title","owner_agent_id"]]'::jsonb,
      'allowed_targets', '["service_object"]'::jsonb,
      'allowed_fields', '["service_object_id","code","title","owner_agent_id","patches"]'::jsonb,
      'relational_fields', '["code","title","owner_agent_id"]'::jsonb,
      'operations', '["SET","REMOVE"]'::jsonb,
      'attrs_patch_operations', '["SET","REMOVE"]'::jsonb,
      'bounded_patch', true,
      'mutation_scope', '["service_object.code","service_object.title","service_object.owner_agent_id","service_object.attrs"]'::jsonb,
      'state_mutation_allowed', false,
      'calculated_values_allowed', true,
      'reasoning_inside_handler', false,
      'primitive_v1', true,
      'primitive_v1_frozen', true,
      'deprecated', false
    ),
    updated_at = now()
FROM global_list gl
WHERE dv.list_id = gl.id
  AND dv.code = 'SERVICE_OBJECT_PATCH';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM eip_core.dropdown_list dl
    JOIN eip_core.dropdown_value dv ON dv.list_id = dl.id
    WHERE dl.code = 'PROCESS_EFFECT_TYPE'
      AND dl.tenant_id IS NULL
      AND dl.is_active = true
      AND dv.code = 'SERVICE_OBJECT_PATCH'
      AND dv.is_active = true
  ) THEN
    RAISE EXCEPTION 'SERVICE_OBJECT_PATCH_CANONICAL_ROW_MISSING';
  END IF;
END $$;

WITH global_list AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND tenant_id IS NULL
    AND is_active = true
  ORDER BY version DESC
  LIMIT 1
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT
  global_list.id,
  'LINK_PATCH',
  'Link Patch',
  75,
  true,
  jsonb_build_object(
    'canonical_public_effect_code', 'LINK_PATCH',
    'canonical_effect_code', 'LINK_PATCH',
    'runtime_handler', 'linkPatch',
    'object_family', 'object_link',
    'semantic_class', 'primitive_object_effect',
    'required_fields', '["src_kind","src_id","dst_kind","dst_id","relation_type","patches"]'::jsonb,
    'allowed_targets', '["object_link"]'::jsonb,
    'allowed_fields', '["src_kind","src_id","dst_kind","dst_id","relation_type","patches"]'::jsonb,
    'operations', '["SET","REMOVE"]'::jsonb,
    'mutation_scope', '["object_link.attrs"]'::jsonb,
    'identity_mutation_allowed', false,
    'bounded_patch', true,
    'calculated_values_allowed', true,
    'reasoning_inside_handler', false,
    'primitive_v1', true,
    'primitive_v1_frozen', true,
    'deprecated', false
  )
FROM global_list
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = true,
    attrs = EXCLUDED.attrs,
    updated_at = now();

-- Tenant Effect lists may not redefine the contract of either final primitive.
WITH global_list AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND tenant_id IS NULL
    AND is_active = true
  ORDER BY version DESC
  LIMIT 1
), canonical AS (
  SELECT dv.code, dv.label, dv.sort_order, dv.attrs
  FROM eip_core.dropdown_value dv
  JOIN global_list gl ON gl.id = dv.list_id
  WHERE dv.code IN ('SERVICE_OBJECT_PATCH', 'LINK_PATCH')
    AND dv.is_active = true
), tenant_effect_lists AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND tenant_id IS NOT NULL
    AND is_active = true
)
UPDATE eip_core.dropdown_value dv
SET label = canonical.label,
    sort_order = canonical.sort_order,
    is_active = true,
    attrs = canonical.attrs,
    updated_at = now()
FROM canonical, tenant_effect_lists tel
WHERE dv.list_id = tel.id
  AND dv.code = canonical.code;

-- Freeze marker applies to every active Effect catalogue. Expansion after this point
-- requires the Primitive V1 admission test and a new forward migration.
UPDATE eip_core.dropdown_list
SET attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object(
      'primitive_v1_locked', true,
      'primitive_v1_frozen', true,
      'primitive_v1_freeze_migration', 'v2_0038',
      'primitive_v1_document', 'docs/architecture/EFFECT_LIBRARY_PRIMITIVE_V1.md'
    ),
    updated_at = now()
WHERE code = 'PROCESS_EFFECT_TYPE'
  AND is_active = true;

-- A locked catalogue may expose only canonical Primitive V1 codes plus the explicitly
-- bounded historical compatibility identities. Unknown/custom Effect identities must be
-- reviewed rather than silently becoming a tenant-specific second Effect library.
DO $$
DECLARE
  v_unknown_count bigint;
BEGIN
  SELECT count(*)
  INTO v_unknown_count
  FROM eip_core.dropdown_list dl
  JOIN eip_core.dropdown_value dv ON dv.list_id = dl.id
  WHERE dl.code = 'PROCESS_EFFECT_TYPE'
    AND dl.is_active = true
    AND dv.is_active = true
    AND dv.code NOT IN (
      'SERVICE_OBJECT_CREATE',
      'SERVICE_OBJECT_PATCH',
      'SERVICE_OBJECT_STATE_TRANSITION',
      'TASK_CREATE',
      'TASK_PATCH',
      'TASK_STATE_TRANSITION',
      'LINK_CREATE',
      'LINK_PATCH',
      'LINK_REMOVE',
      'INFO_RECORD_CREATE',
      'PROCESS_START',
      'ACCESS_GRANT_CREATE',
      'ACCESS_GRANT_PATCH',
      'CHILD_SERVICE_OBJECT_CREATE',
      'STATUS_SET',
      'SO_UPDATE',
      'TASK_UPDATE',
      'INFO_RECORD_WRITE',
      'ACCESS_GRANT_UPDATE',
      'INSTANCE_START',
      'SO_CREATE',
      'SO_STATUS',
      'TASK_STATUS',
      'LINK'
    );

  IF v_unknown_count > 0 THEN
    RAISE EXCEPTION
      'PRIMITIVE_EFFECT_V1_FREEZE_CONFLICT: % active unapproved Effect catalogue row(s) remain',
      v_unknown_count;
  END IF;
END $$;

-- Business/module-specific operations must remain absent from active Effect authority.
DO $$
DECLARE
  v_forbidden_count bigint;
BEGIN
  SELECT count(*)
  INTO v_forbidden_count
  FROM eip_core.dropdown_list dl
  JOIN eip_core.dropdown_value dv ON dv.list_id = dl.id
  WHERE dl.code = 'PROCESS_EFFECT_TYPE'
    AND dl.is_active = true
    AND dv.is_active = true
    AND dv.code IN (
      'INVENTORY_MOVE',
      'INVENTORY_CONSUME',
      'INVENTORY_PRODUCE',
      'INVENTORY_CONVERT',
      'VARIANT_INVENTORY_VALIDATE',
      'JSON_MERGE',
      'ATTRS_MERGE',
      'HTTP_REQUEST',
      'API_CALL'
    );

  IF v_forbidden_count > 0 THEN
    RAISE EXCEPTION
      'PRIMITIVE_EFFECT_V1_FORBIDDEN_ACTIVE:%',
      v_forbidden_count;
  END IF;
END $$;

COMMIT;
