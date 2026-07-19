BEGIN;

WITH shell_config AS (
  SELECT
    'core_process_workbench'::text AS code,
    jsonb_build_object(
      'brand_label', 'EIP CORE',
      'nav_title', 'Owner Admin Console',
      'helper_text', 'Platform authority shell for owner-admin operations. Tenant variability is metadata-governed.',
      'layout_variant', 'platform_standard',
      'logo_key', 'brand.eip_core.logo.light',
      'hero_key', 'brand.eip_core.hero.dark',
      'icon_key', 'brand.eip_core.icon.square',
      'favicon_key', 'brand.eip_core.icon.square',
      'tokens', jsonb_build_object(
        'bg_base', '#060e2b',
        'bg_surface', '#102251',
        'bg_card', '#132a63',
        'text_primary', '#eef3ff',
        'text_muted', '#9fb2de',
        'line_soft', '#2b4788',
        'accent_primary', '#61b0ff',
        'accent_secondary', '#a7d4ff',
        'accent_glow', 'rgba(98, 170, 255, 0.34)'
      )
    ) AS shell_json,
    jsonb_build_object(
      'label', 'Core Workbench',
      'order', 10,
      'default', true,
      'asset_key', 'surface.process'
    ) AS nav_json
  UNION ALL
  SELECT
    'ecom_process_workbench',
    jsonb_build_object(
      'brand_label', 'EIP CORE',
      'nav_title', 'Owner Admin Console',
      'helper_text', 'Platform owner-admin console with governed ecommerce process composition.',
      'layout_variant', 'platform_standard',
      'logo_key', 'brand.eip_core.logo.light',
      'hero_key', 'brand.eip_core.hero.dark',
      'icon_key', 'brand.eip_core.icon.square',
      'favicon_key', 'brand.eip_core.icon.square',
      'tokens', jsonb_build_object(
        'bg_base', '#050d27',
        'bg_surface', '#0f204e',
        'bg_card', '#12295f',
        'text_primary', '#eef3ff',
        'text_muted', '#a3b7e4',
        'line_soft', '#2d4b8d',
        'accent_primary', '#63b4ff',
        'accent_secondary', '#abd7ff',
        'accent_glow', 'rgba(99, 180, 255, 0.36)'
      )
    ),
    jsonb_build_object(
      'label', 'Ecom Workbench',
      'order', 20,
      'default', false,
      'asset_key', 'surface.ecom'
    )
  UNION ALL
  SELECT
    'ecom_review_console',
    jsonb_build_object(
      'brand_label', 'EIP CORE',
      'nav_title', 'Owner Admin Console',
      'helper_text', 'Review console surfaces stay platform-governed and permission-controlled.',
      'layout_variant', 'platform_compact',
      'logo_key', 'brand.eip_core.logo.light',
      'hero_key', 'brand.eip_core.hero.dark',
      'icon_key', 'brand.eip_core.icon.square',
      'favicon_key', 'brand.eip_core.icon.square',
      'tokens', jsonb_build_object(
        'bg_base', '#040b22',
        'bg_surface', '#0d1d47',
        'bg_card', '#122757',
        'text_primary', '#edf3ff',
        'text_muted', '#9db2de',
        'line_soft', '#294581',
        'accent_primary', '#5ea8f7',
        'accent_secondary', '#a7d4ff',
        'accent_glow', 'rgba(90, 164, 245, 0.34)'
      )
    ),
    jsonb_build_object(
      'label', 'Ecom Review Console',
      'order', 30,
      'default', false,
      'asset_key', 'surface.ecom.review'
    )
)
UPDATE eip_core.ui_surface surface
SET attrs = COALESCE(surface.attrs, '{}'::jsonb)
           || jsonb_build_object(
                'owner_admin_shell', shell_config.shell_json,
                'surface_nav', shell_config.nav_json,
                'source', 'v2_0017'
              ),
    updated_at = now()
FROM shell_config
WHERE surface.tenant_id IS NULL
  AND surface.version = 1
  AND surface.code = shell_config.code;

COMMIT;
