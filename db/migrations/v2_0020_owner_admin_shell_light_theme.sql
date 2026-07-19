BEGIN;

WITH light_theme AS (
  SELECT
    jsonb_build_object(
      'bg_base', '#f4f7fb',
      'bg_surface', '#ffffff',
      'bg_card', '#ffffff',
      'text_primary', '#13233f',
      'text_muted', '#5f7397',
      'line_soft', '#d6dfec',
      'accent_primary', '#2f6fe8',
      'accent_secondary', '#6ea0ff',
      'accent_glow', 'rgba(47, 111, 232, 0.24)'
    ) AS tokens,
    'Admin Console'::text AS nav_title
), profile_codes AS (
  SELECT unnest(ARRAY['EIP_CORE_STANDARD', 'EIP_ECOM_STANDARD', 'EIP_ECOM_REVIEW']) AS code
)
UPDATE eip_core.ui_shell_profile_revision AS revision
SET payload = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                COALESCE(revision.payload, '{}'::jsonb),
                '{nav_title}',
                to_jsonb(light_theme.nav_title),
                true
              ),
              '{hero_key}',
              'null'::jsonb,
              true
            ),
            '{logo_key}',
            to_jsonb('brand.eip_core.logo.light'::text),
            true
          ),
          '{icon_key}',
          to_jsonb('brand.eip_core.icon.square'::text),
          true
        ),
        '{favicon_key}',
        to_jsonb('brand.eip_core.icon.square'::text),
        true
      ),
      '{tokens}',
      light_theme.tokens,
      true
    ),
    attrs = COALESCE(revision.attrs, '{}'::jsonb) || jsonb_build_object(
      'source', 'v2_0020',
      'theme_refresh', 'owner_admin_light'
    ),
    updated_at = now()
FROM eip_core.ui_shell_profile AS profile
CROSS JOIN light_theme
WHERE revision.profile_id = profile.id
  AND profile.code IN (SELECT code FROM profile_codes)
  AND revision.lifecycle_status IN ('published', 'draft');

WITH light_theme AS (
  SELECT
    jsonb_build_object(
      'bg_base', '#f4f7fb',
      'bg_surface', '#ffffff',
      'bg_card', '#ffffff',
      'text_primary', '#13233f',
      'text_muted', '#5f7397',
      'line_soft', '#d6dfec',
      'accent_primary', '#2f6fe8',
      'accent_secondary', '#6ea0ff',
      'accent_glow', 'rgba(47, 111, 232, 0.24)'
    ) AS tokens,
    'Admin Console'::text AS nav_title
), profile_values AS (
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
      jsonb_set(
        jsonb_set(
          COALESCE(value.attrs, '{}'::jsonb),
          '{nav_title}',
          to_jsonb(light_theme.nav_title),
          true
        ),
        '{hero_key}',
        'null'::jsonb,
        true
      ),
      '{tokens}',
      light_theme.tokens,
      true
    ),
    updated_at = now()
FROM light_theme
WHERE value.id IN (SELECT id FROM profile_values);

COMMIT;
