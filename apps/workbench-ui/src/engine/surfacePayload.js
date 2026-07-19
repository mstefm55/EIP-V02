const MAX_JSON_DEPTH = 20;
const MAX_TREE_DEPTH = 30;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeJsonValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > MAX_JSON_DEPTH) return null;

  const valueType = typeof value;
  if (valueType === "string") return value;
  if (valueType === "number") return Number.isFinite(value) ? value : null;
  if (valueType === "boolean") return value;
  if (valueType !== "object") return null;

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonValue(entry, depth + 1));
  }

  if (!isPlainObject(value)) return null;
  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    sanitized[key] = sanitizeJsonValue(entry, depth + 1);
  }
  return sanitized;
}

function sanitizeNode(node, depth = 0) {
  if (!isPlainObject(node)) return null;
  if (depth > MAX_TREE_DEPTH) return null;

  const type = String(node.type || "").trim();
  if (!type) return null;

  const sanitized = {
    type,
    props: sanitizeJsonValue(node.props || {}, 0) || {},
    children: [],
  };

  const id = String(node.id || "").trim();
  if (id) sanitized.id = id;

  if (Array.isArray(node.children)) {
    sanitized.children = node.children
      .map((child) => sanitizeNode(child, depth + 1))
      .filter(Boolean);
  }

  return sanitized;
}

function sanitizeSurfacePayload(surface) {
  if (!isPlainObject(surface)) return null;

  const tree = sanitizeNode(surface.tree, 0);
  if (!tree) return null;

  return {
    id: surface.id || null,
    tenant_id: surface.tenant_id || null,
    code: surface.code || null,
    title: surface.title || null,
    version: Number.isFinite(surface.version) ? surface.version : null,
    is_active: surface.is_active === true,
    is_published: surface.is_published === true,
    is_public: surface.is_public === true,
    attrs: sanitizeJsonValue(surface.attrs || {}, 0) || {},
    shell_theme: sanitizeJsonValue(surface.shell_theme || {}, 0) || {},
    created_at: surface.created_at || null,
    updated_at: surface.updated_at || null,
    tree,
  };
}

function toIntegerOrFallback(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBooleanOrFalse(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function sanitizeSurfaceCatalogItem(item) {
  if (!isPlainObject(item)) return null;

  const code = String(item.code || "").trim();
  if (!code) return null;

  const navLabel = String(item.nav_label || item.title || code).trim() || code;
  const title = String(item.title || navLabel || code).trim() || navLabel;
  const module = String(item.module || "").trim() || null;
  const realm = String(item.realm || "").trim() || null;
  const surfaceKind = String(item.surface_kind || "").trim() || null;
  const assetKey = String(item.asset_key || "").trim() || null;
  const navIcon = String(item.nav_icon || "").trim() || null;

  return {
    code,
    nav_label: navLabel,
    title,
    nav_order: toIntegerOrFallback(item.nav_order, 1000),
    is_default: item.is_default === true || toBooleanOrFalse(item.is_default),
    module,
    realm,
    surface_kind: surfaceKind,
    asset_key: assetKey,
    nav_icon: navIcon,
    version: toIntegerOrFallback(item.version, null),
    updated_at: item.updated_at || null,
  };
}

function sanitizeSurfaceCatalogPayload(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = rawItems
    .map((item) => sanitizeSurfaceCatalogItem(item))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.nav_order !== right.nav_order) {
        return left.nav_order - right.nav_order;
      }
      return left.nav_label.localeCompare(right.nav_label);
    });

  return {
    items,
    tenant_id: payload?.tenant_id || null,
    realm: payload?.realm || null,
  };
}

export {
  sanitizeJsonValue,
  sanitizeSurfaceCatalogPayload,
  sanitizeSurfacePayload,
};
