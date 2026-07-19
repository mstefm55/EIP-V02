BEGIN;

-- 1) Platform-governed owner-admin shell/theme profiles.
--    This keeps shell/theme identity outside ui_surface composition payloads.
WITH upsert_list AS (
  INSERT INTO eip_core.dropdown_list
    (tenant_id, module, code, name, version, is_active, attrs)
  VALUES
    (
      NULL,
      'ui',
      'OWNER_ADMIN_SHELL_PROFILE',
      'Owner Admin Shell Profile',
      1,
      true,
      '{
        "governance": {
          "layer": "platform_shell_theme",
          "override_setting_key": "OWNER_ADMIN_SHELL_THEME_OVERRIDE",
          "allow_raw_css": false,
          "allow_runtime_code": false
        }
      }'::jsonb
    )
  ON CONFLICT (tenant_id, module, code, version) DO UPDATE
    SET name = EXCLUDED.name,
        is_active = EXCLUDED.is_active,
        attrs = EXCLUDED.attrs,
        updated_at = now()
  RETURNING id
)
INSERT INTO eip_core.dropdown_value
  (list_id, code, label, sort_order, is_active, attrs)
SELECT
  upsert_list.id,
  src.code,
  src.label,
  src.sort_order,
  true,
  src.attrs::jsonb
FROM upsert_list
CROSS JOIN (
  VALUES
    (
      'EIP_CORE_STANDARD',
      'EIP Core Standard',
      10,
      '{
        "brand_label": "EIP CORE",
        "nav_title": "Owner Admin Console",
        "helper_text": "Platform authority shell for owner-admin operations. Tenant variability is metadata-governed.",
        "layout_variant": "platform_standard",
        "logo_key": "brand.eip_core.logo.light",
        "hero_key": "brand.eip_core.hero.dark",
        "icon_key": "brand.eip_core.icon.square",
        "favicon_key": "brand.eip_core.icon.square",
        "tokens": {
          "bg_base": "#060e2b",
          "bg_surface": "#102251",
          "bg_card": "#132a63",
          "text_primary": "#eef3ff",
          "text_muted": "#9fb2de",
          "line_soft": "#2b4788",
          "accent_primary": "#61b0ff",
          "accent_secondary": "#a7d4ff",
          "accent_glow": "rgba(98, 170, 255, 0.34)"
        }
      }'
    ),
    (
      'EIP_ECOM_STANDARD',
      'EIP Ecom Standard',
      20,
      '{
        "brand_label": "EIP CORE",
        "nav_title": "Owner Admin Console",
        "helper_text": "Platform owner-admin console with governed ecommerce process composition.",
        "layout_variant": "platform_standard",
        "logo_key": "brand.eip_core.logo.light",
        "hero_key": "brand.eip_core.hero.dark",
        "icon_key": "brand.eip_core.icon.square",
        "favicon_key": "brand.eip_core.icon.square",
        "tokens": {
          "bg_base": "#050d27",
          "bg_surface": "#0f204e",
          "bg_card": "#12295f",
          "text_primary": "#eef3ff",
          "text_muted": "#a3b7e4",
          "line_soft": "#2d4b8d",
          "accent_primary": "#63b4ff",
          "accent_secondary": "#abd7ff",
          "accent_glow": "rgba(99, 180, 255, 0.36)"
        }
      }'
    ),
    (
      'EIP_ECOM_REVIEW',
      'EIP Ecom Review Compact',
      30,
      '{
        "brand_label": "EIP CORE",
        "nav_title": "Owner Admin Console",
        "helper_text": "Review console surfaces stay platform-governed and permission-controlled.",
        "layout_variant": "platform_compact",
        "logo_key": "brand.eip_core.logo.light",
        "hero_key": "brand.eip_core.hero.dark",
        "icon_key": "brand.eip_core.icon.square",
        "favicon_key": "brand.eip_core.icon.square",
        "tokens": {
          "bg_base": "#040b22",
          "bg_surface": "#0d1d47",
          "bg_card": "#122757",
          "text_primary": "#edf3ff",
          "text_muted": "#9db2de",
          "line_soft": "#294581",
          "accent_primary": "#5ea8f7",
          "accent_secondary": "#a7d4ff",
          "accent_glow": "rgba(90, 164, 245, 0.34)"
        }
      }'
    )
) AS src(code, label, sort_order, attrs)
ON CONFLICT (list_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    attrs = EXCLUDED.attrs,
    updated_at = now();

-- 2) Move shell ownership in surfaces to governed profile references.
WITH surface_profile_map AS (
  SELECT *
  FROM (
    VALUES
      ('core_process_workbench', 'EIP_CORE_STANDARD'),
      ('ecom_process_workbench', 'EIP_ECOM_STANDARD'),
      ('ecom_review_console', 'EIP_ECOM_REVIEW')
  ) AS mapped(surface_code, profile_code)
)
UPDATE eip_core.ui_surface surface
SET attrs = jsonb_set(
      COALESCE(surface.attrs, '{}'::jsonb) - 'owner_admin_shell',
      '{shell_profile_code}',
      to_jsonb(
        COALESCE(
          NULLIF(btrim(surface.attrs->>'shell_profile_code'), ''),
          mapped.profile_code
        )::text
      ),
      true
    ),
    updated_at = now()
FROM surface_profile_map mapped
WHERE surface.tenant_id IS NULL
  AND surface.version = 1
  AND surface.code = mapped.surface_code;

-- 3) Cleanup any remaining global embedded shell payloads and keep profile fallback explicit.
UPDATE eip_core.ui_surface surface
SET attrs = jsonb_set(
      COALESCE(surface.attrs, '{}'::jsonb) - 'owner_admin_shell',
      '{shell_profile_code}',
      to_jsonb(
        COALESCE(
          NULLIF(btrim(surface.attrs->>'shell_profile_code'), ''),
          'EIP_CORE_STANDARD'
        )::text
      ),
      true
    ),
    updated_at = now()
WHERE surface.tenant_id IS NULL
  AND surface.version = 1
  AND COALESCE(surface.attrs, '{}'::jsonb) ? 'owner_admin_shell';

COMMIT;
