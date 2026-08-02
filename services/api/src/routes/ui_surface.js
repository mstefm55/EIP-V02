import { createHash } from "node:crypto";
import { withTenantTransaction } from "../db/tenantTransaction.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOptionalText(value) {
  const trimmed = normalizeText(value);
  return trimmed.length ? trimmed : null;
}

function normalizeRealm(value, fallback = "EIP") {
  return normalizeOptionalText(value) || fallback;
}

const OWNER_SHELL_FALLBACK_PROFILE_CODE = "EIP_CORE_STANDARD";
const OWNER_SHELL_OVERRIDE_SETTING_KEY = "OWNER_ADMIN_SHELL_THEME_OVERRIDE";
const OWNER_SHELL_SELECTION_SETTING_KEY = "OWNER_ADMIN_SHELL_PROFILE_SELECTION";
const OWNER_SHELL_LEGACY_FAVICON_KEY = "brand.eip_core.icon.square";
const OWNER_SHELL_MODERN_FAVICON_KEY = "brand.eip_core.favicon.modern";
const OWNER_SHELL_ALLOWED_LAYOUTS = new Set([
  "platform_standard",
  "platform_compact",
  "platform_wide",
]);
const OWNER_SHELL_DEFAULT_TOKENS = Object.freeze({
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
const OWNER_SHELL_TOKEN_KEYS = new Set(Object.keys(OWNER_SHELL_DEFAULT_TOKENS));
const OWNER_SHELL_COLOR_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const OWNER_SHELL_COLOR_RGB = /^rgba?\(\s*(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])(?:\s*,\s*(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])){2}(?:\s*,\s*(?:0|0?\.\d+|1(?:\.0+)?))?\s*\)$/;
const OWNER_SHELL_COLOR_HSL = /^hsla?\(\s*(?:\d|[1-2]\d{1,2}|3[0-5]\d)(?:\s*,\s*(?:\d|[1-9]\d|100)%){2}(?:\s*,\s*(?:0|0?\.\d+|1(?:\.0+)?))?\s*\)$/;
const OWNER_SHELL_FALLBACK_THEME = Object.freeze({
  brand_label: "EIP CORE",
  nav_title: "Admin Console",
  helper_text: "Platform authority shell for owner-admin operations. Tenant variability is metadata-governed.",
  logo_key: "brand.eip_core.logo.light",
  hero_key: null,
  icon_key: "brand.eip_core.icon.square",
  favicon_key: OWNER_SHELL_MODERN_FAVICON_KEY,
  layout_variant: "platform_standard",
  tokens: OWNER_SHELL_DEFAULT_TOKENS,
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeThemeText(value, max = 160) {
  return normalizeText(value).slice(0, max);
}

function isSafeColorToken(value) {
  const candidate = normalizeThemeText(value, 64);
  if (!candidate) return false;
  return OWNER_SHELL_COLOR_HEX.test(candidate)
    || OWNER_SHELL_COLOR_RGB.test(candidate)
    || OWNER_SHELL_COLOR_HSL.test(candidate);
}

function sanitizeThemeTokens(rawTokens, fallbackTokens = OWNER_SHELL_DEFAULT_TOKENS) {
  const tokens = { ...(isObject(fallbackTokens) ? fallbackTokens : OWNER_SHELL_DEFAULT_TOKENS) };
  if (!isObject(rawTokens)) return tokens;

  for (const [key, value] of Object.entries(rawTokens)) {
    if (!OWNER_SHELL_TOKEN_KEYS.has(key)) continue;
    if (!isSafeColorToken(value)) continue;
    tokens[key] = normalizeThemeText(value, 64);
  }

  return tokens;
}

function sanitizeThemeLayoutVariant(value, fallback = "platform_standard") {
  const candidate = normalizeThemeText(value, 40).toLowerCase();
  if (!candidate) return fallback;
  if (!OWNER_SHELL_ALLOWED_LAYOUTS.has(candidate)) return fallback;
  return candidate;
}

function sanitizeThemeAssetKey(value, fallback) {
  const candidate = normalizeThemeText(value, 96);
  if (!candidate) return fallback;
  return candidate;
}

function sanitizeProfileCode(value) {
  const candidate = normalizeThemeText(value, 80).toUpperCase();
  if (!candidate) return null;
  if (!/^[A-Z0-9_.:-]+$/.test(candidate)) return null;
  return candidate;
}

function sanitizeSurfaceMapKey(value) {
  const candidate = normalizeThemeText(value, 80).toLowerCase();
  if (!candidate) return null;
  if (!/^[a-z0-9_.:-]+$/.test(candidate)) return null;
  return candidate;
}

function sanitizeThemePayload(rawTheme, fallbackTheme = OWNER_SHELL_FALLBACK_THEME) {
  const safeRaw = isObject(rawTheme) ? rawTheme : {};
  const safeFallback = isObject(fallbackTheme) ? fallbackTheme : OWNER_SHELL_FALLBACK_THEME;
  const rawFaviconKey = safeRaw.favicon_key === OWNER_SHELL_LEGACY_FAVICON_KEY
    ? OWNER_SHELL_MODERN_FAVICON_KEY
    : safeRaw.favicon_key;
  const rawIconKey = safeRaw.icon_key;
  const safeFallbackFavicon = safeFallback.favicon_key || OWNER_SHELL_MODERN_FAVICON_KEY;
  const resolvedFaviconKey = sanitizeThemeAssetKey(rawFaviconKey, safeFallbackFavicon);
  const safeFaviconKey = resolvedFaviconKey
    === OWNER_SHELL_LEGACY_FAVICON_KEY
    ? OWNER_SHELL_MODERN_FAVICON_KEY
    : resolvedFaviconKey;

  return {
    brand_label: normalizeThemeText(safeRaw.brand_label, 80) || safeFallback.brand_label,
    nav_title: normalizeThemeText(safeRaw.nav_title, 80) || safeFallback.nav_title,
    helper_text: normalizeThemeText(safeRaw.helper_text, 220) || safeFallback.helper_text,
    logo_key: sanitizeThemeAssetKey(safeRaw.logo_key, safeFallback.logo_key),
    hero_key: sanitizeThemeAssetKey(safeRaw.hero_key, safeFallback.hero_key),
    icon_key: sanitizeThemeAssetKey(rawIconKey, safeFallback.icon_key),
    favicon_key: safeFaviconKey,
    layout_variant: sanitizeThemeLayoutVariant(safeRaw.layout_variant, safeFallback.layout_variant),
    tokens: sanitizeThemeTokens(safeRaw.tokens, safeFallback.tokens),
  };
}

function mergeThemePayload(baseTheme, overrideTheme) {
  const base = sanitizeThemePayload(baseTheme, OWNER_SHELL_FALLBACK_THEME);
  if (!isObject(overrideTheme)) return base;

  const merged = {
    ...base,
    ...overrideTheme,
    tokens: {
      ...(isObject(base.tokens) ? base.tokens : {}),
      ...(isObject(overrideTheme.tokens) ? overrideTheme.tokens : {}),
    },
  };

  return sanitizeThemePayload(merged, base);
}

export async function fetchTenantSetting(app, { tenantId, settingKey }) {
  if (!tenantId) return null;
  const key = normalizeOptionalText(settingKey);
  if (!key) return null;

  const result = await withTenantTransaction(app.db, tenantId, (client, context) =>
    client.query(
      `
      SELECT setting_value, updated_at
      FROM tenant.tenant_settings
      WHERE tenant_id = $1
        AND setting_key = $2
        AND setting_status = 'active'
      LIMIT 1
      `,
      [context.tenantId, key]
    )
  );

  return result.rows[0] || null;
}

async function fetchOwnerShellTenantOverride(app, { tenantId }) {
  return fetchTenantSetting(app, {
    tenantId,
    settingKey: OWNER_SHELL_OVERRIDE_SETTING_KEY,
  });
}

async function fetchOwnerShellTenantSelection(app, { tenantId }) {
  return fetchTenantSetting(app, {
    tenantId,
    settingKey: OWNER_SHELL_SELECTION_SETTING_KEY,
  });
}

async function fetchPublishedOwnerShellProfileRevision(app, { profileCode }) {
  const code = sanitizeProfileCode(profileCode);
  if (!code) return null;

  const result = await app.db.query(
    `
    SELECT
      profile.profile_id,
      profile.profile_code,
      profile.profile_label,
      profile.profile_scope,
      profile.template_kind,
      profile.template_key,
      profile.revision_id,
      profile.profile_version,
      profile.payload,
      profile.published_at,
      profile.revision_updated_at AS updated_at
    FROM eip_core.ui_shell_profile_published AS profile
    WHERE profile.profile_code = $1
    LIMIT 1
    `,
    [code]
  );

  return result.rows[0] || null;
}

function sanitizeProfileSelectionPayload(rawPayload) {
  if (!isObject(rawPayload)) return { global_profile_code: null, surface: {} };

  const globalProfileCode = sanitizeProfileCode(rawPayload.global_profile_code);
  const surface = {};
  if (isObject(rawPayload.surface)) {
    for (const [rawSurfaceCode, rawProfileCode] of Object.entries(rawPayload.surface)) {
      const surfaceCode = sanitizeSurfaceMapKey(rawSurfaceCode);
      const profileCode = sanitizeProfileCode(rawProfileCode);
      if (!surfaceCode || !profileCode) continue;
      surface[surfaceCode] = profileCode;
    }
  }

  return {
    global_profile_code: globalProfileCode,
    surface,
  };
}

function sanitizeThemeOverridePayload(rawPayload) {
  if (!isObject(rawPayload)) {
    return { global: null, profile: {}, surface: {} };
  }

  const profile = {};
  if (isObject(rawPayload.profile)) {
    for (const [rawProfileCode, payload] of Object.entries(rawPayload.profile)) {
      const profileCode = sanitizeProfileCode(rawProfileCode);
      if (!profileCode || !isObject(payload)) continue;
      profile[profileCode] = payload;
    }
  }

  const surface = {};
  if (isObject(rawPayload.surface)) {
    for (const [rawSurfaceCode, payload] of Object.entries(rawPayload.surface)) {
      const surfaceCode = sanitizeSurfaceMapKey(rawSurfaceCode);
      if (!surfaceCode || !isObject(payload)) continue;
      surface[surfaceCode] = payload;
    }
  }

  return {
    global: isObject(rawPayload.global) ? rawPayload.global : null,
    profile,
    surface,
  };
}

function buildCandidateProfileCodes({ selectionProfileCode, surfaceProfileCode }) {
  const ordered = [];
  const seen = new Set();

  for (const candidate of [
    selectionProfileCode,
    surfaceProfileCode,
    OWNER_SHELL_FALLBACK_PROFILE_CODE,
  ]) {
    const code = sanitizeProfileCode(candidate);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    ordered.push(code);
  }

  return ordered;
}

async function resolveOwnerShellProfileRevision(app, {
  surfaceProfileCode,
  selectionProfileCode,
}) {
  const candidates = buildCandidateProfileCodes({
    selectionProfileCode,
    surfaceProfileCode,
  });

  for (const profileCode of candidates) {
    const row = await fetchPublishedOwnerShellProfileRevision(app, { profileCode });
    if (row) {
      return {
        row,
        resolved_profile_code: row.profile_code,
      };
    }
  }

  return null;
}

function getLatestTimestamp(...candidates) {
  let latest = null;
  for (const candidate of candidates) {
    let date = null;
    if (candidate instanceof Date) {
      date = candidate;
    } else {
      const value = normalizeOptionalText(candidate);
      if (!value) continue;
      date = new Date(value);
    }
    if (!Number.isFinite(date.getTime())) continue;
    if (!latest || date.getTime() > latest.getTime()) {
      latest = date;
    }
  }
  return latest ? latest.toISOString() : null;
}

function buildThemeVersionToken({
  profileCode,
  profileVersion,
  profilePublishedAt,
  profileUpdatedAt,
  selectionUpdatedAt,
  overrideUpdatedAt,
}) {
  const code = sanitizeProfileCode(profileCode) || OWNER_SHELL_FALLBACK_PROFILE_CODE;
  const version = Number.parseInt(String(profileVersion ?? ""), 10);
  const safeVersion = Number.isFinite(version) ? version : 0;
  const latest = getLatestTimestamp(
    profilePublishedAt,
    profileUpdatedAt,
    selectionUpdatedAt,
    overrideUpdatedAt
  ) || "na";
  return `${code}|v:${safeVersion}|t:${latest}`;
}

async function resolveOwnerShellTheme(app, { tenantId, surfaceCode, surfaceAttrs }) {
  const normalizedSurfaceCode = sanitizeSurfaceMapKey(surfaceCode);
  const surfaceProfileCode =
    sanitizeProfileCode(surfaceAttrs?.shell_profile_code) || OWNER_SHELL_FALLBACK_PROFILE_CODE;

  const selectionRow = await fetchOwnerShellTenantSelection(app, { tenantId });
  const selectionPayload = sanitizeProfileSelectionPayload(selectionRow?.setting_value);
  const selectionProfileCode = normalizedSurfaceCode
    ? selectionPayload.surface[normalizedSurfaceCode] || selectionPayload.global_profile_code
    : selectionPayload.global_profile_code;
  const selectionSource = normalizedSurfaceCode && selectionPayload.surface[normalizedSurfaceCode]
    ? "tenant_surface_selection"
    : selectionPayload.global_profile_code
      ? "tenant_global_selection"
      : "surface_default";

  const profileResolution = await resolveOwnerShellProfileRevision(app, {
    surfaceProfileCode,
    selectionProfileCode,
  });

  const profilePayload = profileResolution?.row?.payload || {};
  const baseTheme = sanitizeThemePayload(profilePayload, OWNER_SHELL_FALLBACK_THEME);
  const resolvedProfileCode =
    profileResolution?.row?.profile_code
    || sanitizeProfileCode(selectionProfileCode)
    || surfaceProfileCode
    || OWNER_SHELL_FALLBACK_PROFILE_CODE;
  const normalizedSelectionCode = sanitizeProfileCode(selectionProfileCode);
  const normalizedSurfaceProfileCode = sanitizeProfileCode(surfaceProfileCode);
  const effectiveSelectionSource = normalizedSelectionCode && normalizedSelectionCode !== resolvedProfileCode
    ? "tenant_selection_fallback"
    : normalizedSelectionCode
      ? selectionSource
      : normalizedSurfaceProfileCode === resolvedProfileCode
        ? "surface_default"
        : "fallback_default";

  const overrideRow = await fetchOwnerShellTenantOverride(app, { tenantId });
  const overridePayload = sanitizeThemeOverridePayload(overrideRow?.setting_value);
  const profileOverride = overridePayload.profile[resolvedProfileCode] || null;
  const surfaceOverride = normalizedSurfaceCode
    ? overridePayload.surface[normalizedSurfaceCode] || null
    : null;

  let merged = mergeThemePayload(baseTheme, overridePayload.global);
  merged = mergeThemePayload(merged, profileOverride);
  merged = mergeThemePayload(merged, surfaceOverride);

  const profileVersion = Number.parseInt(
    String(profileResolution?.row?.profile_version ?? ""),
    10
  );
  const safeProfileVersion = Number.isFinite(profileVersion) ? profileVersion : null;
  const themeVersionToken = buildThemeVersionToken({
    profileCode: resolvedProfileCode,
    profileVersion: safeProfileVersion,
    profilePublishedAt: profileResolution?.row?.published_at || null,
    profileUpdatedAt: profileResolution?.row?.updated_at || null,
    selectionUpdatedAt: selectionRow?.updated_at || null,
    overrideUpdatedAt: overrideRow?.updated_at || null,
  });

  return {
    ...merged,
    profile_code: resolvedProfileCode,
    profile_scope: profileResolution?.row?.profile_scope || "platform",
    template_kind: profileResolution?.row?.template_kind || null,
    template_key: profileResolution?.row?.template_key || null,
    profile_version: safeProfileVersion,
    profile_published_at: profileResolution?.row?.published_at || null,
    profile_updated_at: profileResolution?.row?.updated_at || null,
    selection_source: effectiveSelectionSource,
    selection_updated_at: selectionRow?.updated_at || null,
    override_updated_at: overrideRow?.updated_at || null,
    theme_version_token: themeVersionToken,
  };
}

function buildEtag(surface, shellThemeToken) {
  const updated = getLatestTimestamp(surface.updated_at, surface.created_at) || new Date().toISOString();
  const token = normalizeThemeText(shellThemeToken, 200) || "theme:na";
  const digest = createHash("sha1").update(token).digest("hex").slice(0, 12);
  return `W/"${surface.id}:${surface.version}:${updated}:${digest}"`;
}

function buildCatalogEtag(items) {
  const token = items
    .map((item) => `${item.code}:${item.version}:${item.updated_at || item.created_at || ""}`)
    .join("|");
  const digest = createHash("sha1").update(token || "empty").digest("hex");
  return `W/"surface-catalog:${items.length}:${digest}"`;
}

function sendWithConditionalCache(req, reply, { payload, etag, lastModified, cacheControl }) {
  const ifNoneMatch = String(req.headers["if-none-match"] || "");
  reply.header("ETag", etag);

  if (lastModified) {
    reply.header("Last-Modified", new Date(lastModified).toUTCString());
  }
  if (cacheControl) {
    reply.header("Cache-Control", cacheControl);
  }

  if (ifNoneMatch && ifNoneMatch === etag) {
    return reply.code(304).send();
  }

  return reply.send(payload);
}

export async function resolveTenantId(app, { tenantId, tenantCode, allowDirectTenantId = false }) {
  const directTenantId = normalizeOptionalText(tenantId);
  if (allowDirectTenantId && directTenantId) return directTenantId;

  const code = normalizeOptionalText(tenantCode);
  if (!code) return null;

  const r = await app.db.query(
    `
    SELECT tenant_id
    FROM kernel.tenants
    WHERE lower(tenant_code) = lower($1)
      AND tenant_status = 'active'
    LIMIT 1
    `,
    [code]
  );
  return r.rows[0]?.tenant_id ?? null;
}

async function fetchSurface(app, { code, tenantId, publicOnly, realm }) {
  const params = [code];
  let tenantFilter = "tenant_id IS NULL";
  if (tenantId) {
    params.push(tenantId);
    tenantFilter = "(tenant_id = $2 OR tenant_id IS NULL)";
  }

  params.push(normalizeRealm(realm));
  const realmParam = `$${params.length}`;
  const publicFilter = publicOnly ? "AND is_public = true" : "";

  const r = await app.db.query(
    `
    SELECT id, tenant_id, code, title, version, is_active, is_published, is_public,
           tree, attrs, created_at, updated_at
    FROM eip_core.ui_surface
    WHERE code = $1
      AND is_active = true
      AND is_published = true
      AND ${tenantFilter}
      AND (
        NOT (attrs ? 'realm')
        OR nullif(btrim(attrs->>'realm'), '') IS NULL
        OR lower(attrs->>'realm') = lower(${realmParam})
      )
      ${publicFilter}
    ORDER BY (tenant_id IS NOT NULL) DESC, version DESC, coalesce(updated_at, created_at) DESC
    LIMIT 1
    `,
    params
  );
  return r.rows[0] || null;
}

async function fetchSurfaceCatalog(app, { tenantId, publicOnly, realm }) {
  const resolvedRealm = normalizeRealm(realm);
  const params = [resolvedRealm];
  let tenantFilter = "tenant_id IS NULL";
  if (tenantId) {
    params.push(tenantId);
    tenantFilter = "(tenant_id = $2 OR tenant_id IS NULL)";
  }
  const publicFilter = publicOnly ? "AND is_public = true" : "";

  const r = await app.db.query(
    `
    WITH ranked AS (
      SELECT
        id,
        tenant_id,
        code,
        title,
        version,
        attrs,
        created_at,
        updated_at,
        COALESCE(nullif(attrs#>>'{surface_nav,label}', ''), nullif(title, ''), code) AS nav_label,
        CASE
          WHEN (attrs#>>'{surface_nav,order}') ~ '^-?[0-9]+$'
            THEN (attrs#>>'{surface_nav,order}')::integer
          ELSE 1000
        END AS nav_order,
        CASE
          WHEN lower(COALESCE(attrs#>>'{surface_nav,default}', 'false')) IN ('1', 'true', 'yes', 'on')
            THEN true
          ELSE false
        END AS is_default,
        COALESCE(nullif(attrs#>>'{surface_nav,asset_key}', ''), nullif(attrs->>'asset_key', '')) AS asset_key,
        nullif(attrs#>>'{surface_nav,icon}', '') AS nav_icon,
        nullif(attrs->>'module', '') AS module,
        nullif(attrs->>'surface_kind', '') AS surface_kind,
        COALESCE(nullif(attrs->>'realm', ''), $1) AS realm,
        row_number() OVER (
          PARTITION BY code
          ORDER BY (tenant_id IS NOT NULL) DESC, version DESC, coalesce(updated_at, created_at) DESC
        ) AS rn
      FROM eip_core.ui_surface
      WHERE is_active = true
        AND is_published = true
        AND ${tenantFilter}
        AND (
          NOT (attrs ? 'realm')
          OR nullif(btrim(attrs->>'realm'), '') IS NULL
          OR lower(attrs->>'realm') = lower($1)
        )
        ${publicFilter}
    )
    SELECT
      code,
      title,
      version,
      nav_label,
      nav_order,
      is_default,
      asset_key,
      nav_icon,
      module,
      surface_kind,
      realm,
      created_at,
      updated_at
    FROM ranked
    WHERE rn = 1
    ORDER BY nav_order ASC, lower(nav_label) ASC, code ASC
    `,
    params
  );

  return r.rows.map((row) => ({
    code: row.code,
    title: row.title || row.nav_label || row.code,
    nav_label: row.nav_label || row.title || row.code,
    nav_order: Number.parseInt(String(row.nav_order ?? "1000"), 10) || 1000,
    is_default: row.is_default === true,
    asset_key: row.asset_key || null,
    nav_icon: row.nav_icon || null,
    module: row.module || null,
    surface_kind: row.surface_kind || null,
    realm: row.realm || resolvedRealm,
    version: Number.parseInt(String(row.version ?? ""), 10) || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }));
}

function sendSurface(req, reply, surface, cacheControl) {
  const shellThemeToken = surface?.shell_theme?.theme_version_token || "theme:na";
  const etag = buildEtag(surface, shellThemeToken);
  const lastModified = getLatestTimestamp(
    surface.updated_at,
    surface.created_at,
    surface?.shell_theme?.profile_updated_at,
    surface?.shell_theme?.profile_published_at,
    surface?.shell_theme?.selection_updated_at,
    surface?.shell_theme?.override_updated_at
  ) || surface.updated_at || surface.created_at;

  return sendWithConditionalCache(req, reply, {
    etag,
    lastModified,
    cacheControl,
    payload: { ok: true, surface },
  });
}

function sendSurfaceCatalog(req, reply, { items, tenantId, realm, cacheControl }) {
  const etag = buildCatalogEtag(items);
  const latest = items.reduce((cursor, item) => {
    const stamp = item.updated_at || item.created_at;
    if (!stamp) return cursor;
    if (!cursor) return stamp;
    return stamp > cursor ? stamp : cursor;
  }, null);

  return sendWithConditionalCache(req, reply, {
    etag,
    lastModified: latest,
    cacheControl,
    payload: {
      ok: true,
      tenant_id: tenantId || null,
      realm: normalizeRealm(realm),
      items,
    },
  });
}

export default async function uiSurfaceRoutes(app, opts = {}) {
  const isPublic = opts.public === true;

  if (isPublic) {
    app.get(
      "/ui/surfaces",
      {
        schema: {
          querystring: {
            type: "object",
            additionalProperties: false,
            properties: {
              tenant_id: { type: "string", minLength: 36, maxLength: 36 },
              tenant_code: { type: "string", minLength: 1, maxLength: 100 },
              realm: { type: "string", minLength: 1, maxLength: 32 }
            }
          }
        }
      },
      async (req, reply) => {
        const tenantId = await resolveTenantId(app, {
          tenantCode: req.query?.tenant_code
        });
        const realm = normalizeRealm(req.query?.realm);
        const items = await fetchSurfaceCatalog(app, {
          tenantId,
          publicOnly: true,
          realm
        });
        return sendSurfaceCatalog(req, reply, {
          items,
          tenantId,
          realm,
          cacheControl: "public, max-age=60",
        });
      }
    );

    app.get(
      "/ui/surfaces/:code",
      {
        schema: {
          params: {
            type: "object",
            required: ["code"],
            properties: {
              code: { type: "string", minLength: 2, maxLength: 64 }
            }
          },
          querystring: {
            type: "object",
            additionalProperties: false,
            properties: {
              tenant_id: { type: "string", minLength: 36, maxLength: 36 },
              tenant_code: { type: "string", minLength: 1, maxLength: 100 },
              realm: { type: "string", minLength: 1, maxLength: 32 }
            }
          }
        }
      },
      async (req, reply) => {
        const code = normalizeText(req.params.code);
        const tenantId = await resolveTenantId(app, {
          tenantCode: req.query?.tenant_code
        });
        const realm = normalizeRealm(req.query?.realm);
        const surface = await fetchSurface(app, {
          code,
          tenantId,
          publicOnly: true,
          realm,
        });
        if (!surface) {
          return reply.code(404).send({ ok: false, error: "SURFACE_NOT_FOUND" });
        }

        surface.shell_theme = await resolveOwnerShellTheme(app, {
          tenantId,
          surfaceCode: code,
          surfaceAttrs: surface.attrs,
        });

        return sendSurface(req, reply, surface, "public, max-age=60");
      }
    );
    return;
  }

  app.get("/ui/surfaces", async (req, reply) => {
    const s = await app.requireSession(req, { realm: "EIP" });
    if (!s.ok) return reply.code(s.status).send({ ok: false, error: s.error });

    const realm = normalizeRealm(s.session.realm, "EIP");
    const items = await fetchSurfaceCatalog(app, {
      tenantId: s.session.tenant_id,
      publicOnly: false,
      realm,
    });

    return sendSurfaceCatalog(req, reply, {
      items,
      tenantId: s.session.tenant_id,
      realm,
      cacheControl: "private, max-age=0, must-revalidate",
    });
  });

  app.get(
    "/ui/surfaces/:code",
    {
      schema: {
        params: {
          type: "object",
          required: ["code"],
          properties: {
            code: { type: "string", minLength: 2, maxLength: 64 }
          }
        }
      }
    },
    async (req, reply) => {
      const s = await app.requireSession(req, { realm: "EIP" });
      if (!s.ok) return reply.code(s.status).send({ ok: false, error: s.error });

      const code = normalizeText(req.params.code);
      const realm = normalizeRealm(s.session.realm, "EIP");
      const surface = await fetchSurface(app, {
        code,
        tenantId: s.session.tenant_id,
        publicOnly: false,
        realm,
      });
      if (!surface) {
        return reply.code(404).send({ ok: false, error: "SURFACE_NOT_FOUND" });
      }

      surface.shell_theme = await resolveOwnerShellTheme(app, {
        tenantId: s.session.tenant_id,
        surfaceCode: code,
        surfaceAttrs: surface.attrs,
      });

      return sendSurface(req, reply, surface, "private, max-age=0, must-revalidate");
    }
  );
}
