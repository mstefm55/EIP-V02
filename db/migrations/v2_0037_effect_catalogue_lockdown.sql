BEGIN;

-- Primitive V1 catalogue lockdown across global and tenant-scoped Effect lists.
-- No schema expansion. This follows v2_0036 and closes compatibility/override paths
-- that could otherwise act as a shadow Effect catalogue.

-- HTTP execution is an integration/resolver capability, not an Object_Effect mutation.
-- Do not remove it from the Effect catalogue while an active Process still depends on it.
DO $$
DECLARE
  v_conflict_count bigint;
BEGIN
  SELECT count(*)
  INTO v_conflict_count
  FROM eip_core.process_def pd
  WHERE pd.is_active = true
    AND pd.graph::text ~ '"type"\s*:\s*"(HTTP_REQUEST|API_CALL)"';

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION
      'PRIMITIVE_EFFECT_INTEGRATION_CONFLICT: % active process definition(s) still use HTTP_REQUEST/API_CALL as Effects',
      v_conflict_count;
  END IF;
END $$;

-- All active Effect lists, including tenant-scoped overrides, share the Macro-owned
-- applicability and the Primitive V1 lock marker.
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
  AND is_active = true;

-- A tenant override may constrain applicability elsewhere, but it may not redefine the
-- identity or runtime contract of a locked kernel primitive. Existing tenant rows using
-- a Primitive V1 code are normalized to the global canonical contract.
WITH global_list AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND tenant_id IS NULL
    AND is_active = true
  ORDER BY version DESC
  LIMIT 1
), canonical AS (
  SELECT gv.code, gv.label, gv.sort_order, gv.attrs
  FROM eip_core.dropdown_value gv
  JOIN global_list gl ON gl.id = gv.list_id
  WHERE gv.is_active = true
    AND COALESCE((gv.attrs->>'primitive_v1')::boolean, false) = true
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

-- Retired/non-Effect identities are disabled in every active PROCESS_EFFECT_TYPE list,
-- not only the global seed list. The finite runtime dispatcher also rejects them.
WITH effect_lists AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND is_active = true
)
UPDATE eip_core.dropdown_value dv
SET is_active = false,
    attrs = COALESCE(dv.attrs, '{}'::jsonb) || jsonb_build_object(
      'deprecated', true,
      'ui_hidden', true,
      'public_primitive_authority', false,
      'retired_by_migration', 'v2_0037'
    ),
    updated_at = now()
FROM effect_lists el
WHERE dv.list_id = el.id
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

-- Simple historical aliases are normalized to exactly one canonical primitive.
WITH effect_lists AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND is_active = true
), aliases(code, canonical_code) AS (
  VALUES
    ('CHILD_SERVICE_OBJECT_CREATE', 'SERVICE_OBJECT_CREATE'),
    ('SO_CREATE',                   'SERVICE_OBJECT_CREATE'),
    ('SO_UPDATE',                   'SERVICE_OBJECT_PATCH'),
    ('SO_STATUS',                   'SERVICE_OBJECT_STATE_TRANSITION'),
    ('TASK_STATUS',                 'TASK_STATE_TRANSITION'),
    ('LINK',                        'LINK_CREATE'),
    ('INFO_RECORD_WRITE',           'INFO_RECORD_CREATE'),
    ('INSTANCE_START',              'PROCESS_START'),
    ('ACCESS_GRANT_UPDATE',         'ACCESS_GRANT_PATCH')
)
UPDATE eip_core.dropdown_value dv
SET is_active = true,
    attrs = COALESCE(dv.attrs, '{}'::jsonb) || jsonb_build_object(
      'deprecated', true,
      'ui_hidden', true,
      'compatibility_alias_only', true,
      'canonical_effect_code', aliases.canonical_code,
      'canonical_public_effect_code', aliases.canonical_code,
      'replacement_effect_code', aliases.canonical_code,
      'public_primitive_authority', false,
      'primitive_v1', false,
      'alias_contract', 'canonical_contract_only'
    ),
    updated_at = now()
FROM effect_lists el, aliases
WHERE dv.list_id = el.id
  AND dv.code = aliases.code;

-- These two historical identities were overloaded and therefore require a bounded
-- runtime compatibility resolver. They still resolve only to Primitive V1 codes:
-- STATUS_SET -> Service Object or Task state transition based on explicit target;
-- TASK_UPDATE -> Task patch or Task state transition, never both in one Effect.
WITH effect_lists AS (
  SELECT id
  FROM eip_core.dropdown_list
  WHERE code = 'PROCESS_EFFECT_TYPE'
    AND is_active = true
)
UPDATE eip_core.dropdown_value dv
SET is_active = true,
    attrs = COALESCE(dv.attrs, '{}'::jsonb) || jsonb_build_object(
      'deprecated', true,
      'ui_hidden', true,
      'compatibility_alias_only', true,
      'canonical_effect_code', dv.code,
      'public_primitive_authority', false,
      'primitive_v1', false,
      'alias_contract', CASE dv.code
        WHEN 'STATUS_SET' THEN 'target_scoped_state_transition'
        ELSE 'task_patch_or_state_transition'
      END,
      'replacement_effect_code', CASE dv.code
        WHEN 'STATUS_SET' THEN 'SERVICE_OBJECT_STATE_TRANSITION|TASK_STATE_TRANSITION'
        ELSE 'TASK_PATCH|TASK_STATE_TRANSITION'
      END
    ),
    updated_at = now()
FROM effect_lists el
WHERE dv.list_id = el.id
  AND dv.code IN ('STATUS_SET', 'TASK_UPDATE');

COMMIT;
