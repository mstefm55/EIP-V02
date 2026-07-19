BEGIN;

WITH profile_codes AS (
  SELECT unnest(ARRAY['EIP_CORE_STANDARD', 'EIP_ECOM_STANDARD', 'EIP_ECOM_REVIEW']) AS code
)
UPDATE eip_core.ui_shell_profile_revision AS revision
SET payload = jsonb_set(
      COALESCE(revision.payload, '{}'::jsonb),
      '{favicon_key}',
      to_jsonb('brand.eip_core.favicon.modern'::text),
      true
    ),
    attrs = COALESCE(revision.attrs, '{}'::jsonb) || jsonb_build_object(
      'source',
      'v2_0022',
      'branding_refresh',
      'modern_favicon'
    ),
    updated_at = now()
FROM eip_core.ui_shell_profile AS profile
WHERE revision.profile_id = profile.id
  AND profile.code IN (SELECT code FROM profile_codes)
  AND revision.lifecycle_status IN ('published', 'draft')
  AND COALESCE(revision.payload ->> 'favicon_key', '') <> 'brand.eip_core.favicon.modern';

WITH profile_values AS (
  SELECT value.id
  FROM eip_core.dropdown_value AS value
  JOIN eip_core.dropdown_list AS list
    ON list.id = value.list_id
  WHERE list.module = 'ui'
    AND list.code = 'OWNER_ADMIN_SHELL_PROFILE'
    AND value.code IN ('EIP_CORE_STANDARD', 'EIP_ECOM_STANDARD', 'EIP_ECOM_REVIEW')
)
UPDATE eip_core.dropdown_value AS value
SET attrs = jsonb_set(
      COALESCE(value.attrs, '{}'::jsonb),
      '{favicon_key}',
      to_jsonb('brand.eip_core.favicon.modern'::text),
      true
    ),
    updated_at = now()
WHERE value.id IN (SELECT id FROM profile_values)
  AND COALESCE(value.attrs ->> 'favicon_key', '') <> 'brand.eip_core.favicon.modern';

COMMIT;
