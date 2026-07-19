const DEFAULT_TOKENS = Object.freeze({
  bg_base: "#f4f7fb",
  bg_surface: "#ffffff",
  bg_card: "#ffffff",
  text_primary: "#13233f",
  text_muted: "#5f7397",
  line_soft: "#d6dfec",
  accent_primary: "#2f6fe8",
  accent_secondary: "#6ea0ff",
  accent_glow: "rgba(47, 111, 232, 0.24)",
});

const ALLOWED_LAYOUT_VARIANTS = new Set([
  "platform_standard",
  "platform_compact",
  "platform_wide",
]);

const COLOR_TOKEN_KEYS = new Set(Object.keys(DEFAULT_TOKENS));
const COLOR_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const COLOR_RGB = /^rgba?\(\s*(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])(?:\s*,\s*(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])){2}(?:\s*,\s*(?:0|0?\.\d+|1(?:\.0+)?))?\s*\)$/;
const COLOR_HSL = /^hsla?\(\s*(?:\d|[1-2]\d{1,2}|3[0-5]\d)(?:\s*,\s*(?:\d|[1-9]\d|100)%){2}(?:\s*,\s*(?:0|0?\.\d+|1(?:\.0+)?))?\s*\)$/;

const DEFAULT_THEME = Object.freeze({
  brand_label: "EIP CORE",
  helper_text: "Use the navigation menu to manage operations and workflow setup.",
  nav_title: "Admin Console",
  logo_key: "brand.eip_core.logo.light",
  hero_key: null,
  icon_key: "brand.eip_core.icon.square",
  favicon_key: "brand.eip_core.favicon.modern",
  layout_variant: "platform_standard",
  tokens: DEFAULT_TOKENS,
});
const LEGACY_FAVICON_KEY = "brand.eip_core.icon.square";

function normalizeText(value, max = 160) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, max);
}

function isSafeColor(value) {
  const candidate = normalizeText(value, 64);
  if (!candidate) return false;
  return COLOR_HEX.test(candidate) || COLOR_RGB.test(candidate) || COLOR_HSL.test(candidate);
}

function sanitizeTokens(rawTokens) {
  const tokens = { ...DEFAULT_TOKENS };
  if (!rawTokens || typeof rawTokens !== "object") return tokens;

  for (const [key, value] of Object.entries(rawTokens)) {
    if (!COLOR_TOKEN_KEYS.has(key)) continue;
    if (!isSafeColor(value)) continue;
    tokens[key] = normalizeText(value, 64);
  }

  return tokens;
}

function sanitizeLayoutVariant(rawValue) {
  const candidate = normalizeText(rawValue, 40).toLowerCase();
  if (!candidate) return DEFAULT_THEME.layout_variant;
  if (!ALLOWED_LAYOUT_VARIANTS.has(candidate)) return DEFAULT_THEME.layout_variant;
  return candidate;
}

function sanitizeAssetKey(rawValue, resolveAsset) {
  const key = normalizeText(rawValue, 80);
  if (!key) return null;
  return resolveAsset(key) ? key : null;
}

function resolveOwnerAdminTheme(surfaceMeta, resolveAsset) {
  let raw = surfaceMeta;
  if (!raw || typeof raw !== "object") {
    raw = {};
  }

  const brandLabel = normalizeText(raw?.brand_label, 80) || DEFAULT_THEME.brand_label;
  let helperText = normalizeText(raw?.helper_text, 220) || DEFAULT_THEME.helper_text;
  if (helperText.toLowerCase().includes("metadata + server governed")) {
    helperText = DEFAULT_THEME.helper_text;
  }
  const navTitle = normalizeText(raw?.nav_title, 80) || DEFAULT_THEME.nav_title;

  const layoutVariant = sanitizeLayoutVariant(raw?.layout_variant);
  const tokens = sanitizeTokens(raw?.tokens);

  const logoKey = sanitizeAssetKey(raw?.logo_key, resolveAsset) || DEFAULT_THEME.logo_key;
  const heroKey = sanitizeAssetKey(raw?.hero_key, resolveAsset) || DEFAULT_THEME.hero_key;
  const iconKey = sanitizeAssetKey(raw?.icon_key, resolveAsset) || DEFAULT_THEME.icon_key;
  const requestedFaviconKey = sanitizeAssetKey(raw?.favicon_key, resolveAsset);
  const normalizedRequestedFaviconKey = requestedFaviconKey === LEGACY_FAVICON_KEY
    ? null
    : requestedFaviconKey;
  const faviconKey = normalizedRequestedFaviconKey || DEFAULT_THEME.favicon_key;

  return {
    brandLabel,
    helperText,
    navTitle,
    layoutVariant,
    tokens,
    logoKey,
    heroKey,
    iconKey,
    faviconKey,
    logoAsset: resolveAsset(logoKey),
    heroAsset: resolveAsset(heroKey),
    iconAsset: resolveAsset(iconKey),
    faviconAsset: resolveAsset(faviconKey),
  };
}

function buildThemeCssVariables(theme) {
  const tokens = theme?.tokens || DEFAULT_TOKENS;
  return {
    "--oa-bg-base": tokens.bg_base,
    "--oa-bg-surface": tokens.bg_surface,
    "--oa-bg-card": tokens.bg_card,
    "--oa-text-primary": tokens.text_primary,
    "--oa-text-muted": tokens.text_muted,
    "--oa-line-soft": tokens.line_soft,
    "--oa-accent-primary": tokens.accent_primary,
    "--oa-accent-secondary": tokens.accent_secondary,
    "--oa-accent-glow": tokens.accent_glow,
  };
}

export {
  buildThemeCssVariables,
  resolveOwnerAdminTheme,
};
