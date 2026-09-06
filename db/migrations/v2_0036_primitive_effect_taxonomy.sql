BEGIN;

-- EIP Core V2 primitive Object_Effect taxonomy repair.
-- Historical migrations remain immutable. This forward migration:
--   * exposes SERVICE_OBJECT_PATCH as the governed public primitive;
--   * keeps SO_UPDATE only as a runtime compatibility implementation code;
--   * deactivates inventory/business-semantic Effects;
--   * corrects PROCESS_EFFECT_TYPE applicability to Macro-owned Effects.

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

-- Do not silently deactivate a business Effect that an active process still uses.
-- Such a process must first be rewritten as Macro reasoning + primitive Object_Effects.
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

-- Canonical public primitive. Runtime compatibility intentionally delegates to the
-- existing SO_UPDATE implementation until the internal executable code is renamed.
-- This compatibility detail is not business authority and is hidden/deprecated in metadata.
WITH effect_list AS (
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
  effect_list.id,
  'SERVICE_OBJECT_PATCH',
  'Service Object Patch',
  65,
  true,
  jsonb_build_object(
    'canonical_public_effect_code', 'SERVICE_OBJECT_PATCH',
    'canonical_effect_code', 'SO_UPDATE',
    'runtime_compatibility_code', 'SO_UPDATE',
    'runtime_handler', 'serviceObjectUpdate',
    'object_family', 'service_object',
    'semantic_class', 'primitive_object_effect',
    'allowed_targets', jsonb_build_array('service_object'),
    'operations', jsonb_build_array('SET', 'REMOVE'),
    'required_fields', jsonb_build_array('patches'),
    'bounded_patch', true,
    'mutation_scope', jsonb_build_array('attrs'),
    'deprecated', false
  )
FROM effect_list
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = true,
    attrs = EXCLUDED.attrs,
    updated_at = now();

-- SO_UPDATE remains executable only because current code dispatch still uses that
-- internal compatibility code. New governed process metadata must use SERVICE_OBJECT_PATCH.
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
SET attrs = COALESCE(dv.attrs, '{}'::jsonb) || jsonb_build_object(
      'deprecated', true,
      'ui_hidden', true,
      'runtime_internal_compatibility', true,
      'canonical_public_effect_code', 'SERVICE_OBJECT_PATCH',
      'replacement_effect_code', 'SERVICE_OBJECT_PATCH'
    ),
    updated_at = now()
FROM effect_list
WHERE dv.list_id = effect_list.id
  AND dv.code = 'SO_UPDATE';

-- Inventory operations and variant inventory validation are business semantics,
-- not primitive Object_Effects. They belong in Process/Macro reasoning composed
-- from primitive object mutations such as SERVICE_OBJECT_PATCH.
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
      'replacement_effect_code', 'SERVICE_OBJECT_PATCH',
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

-- Effects belong to Macro execution bundles, not transition-local effect arrays.
UPDATE eip_core.dropdown_list
SET attrs = jsonb_set(
      COALESCE(attrs, '{}'::jsonb) || '{"ui":{}}'::jsonb,
      '{ui,applies_to}',
      '["process_def.graph.macros.*.effects"]'::jsonb,
      true
    ),
    updated_at = now()
WHERE code = 'PROCESS_EFFECT_TYPE'
  AND tenant_id IS NULL
  AND is_active = true;

COMMIT;
