const identityVersionIndex = new Map();
const cacheEntries = new Map();

const SURFACE_SELECTION_STORAGE_PREFIX = "v2.ui.surface.last_surface";

function normalizePart(value, fallback) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return fallback;
  return trimmed.toLowerCase().replace(/[^a-z0-9._:-]+/g, "_");
}

function normalizeTenantId(tenantId) {
  return normalizePart(tenantId, "tenant-unknown");
}

function normalizeRealm(realm) {
  return normalizePart(realm, "realm-unknown");
}

function normalizeSurfaceCode(surfaceCode) {
  return normalizePart(surfaceCode, "surface-unknown");
}

function buildSurfaceIdentity({ tenantId, realm, surfaceCode }) {
  return [
    `tenant:${normalizeTenantId(tenantId)}`,
    `realm:${normalizeRealm(realm)}`,
    `surface:${normalizeSurfaceCode(surfaceCode)}`,
  ].join("|");
}

function buildSurfaceCatalogIdentity({ tenantId, realm }) {
  return [
    `tenant:${normalizeTenantId(tenantId)}`,
    `realm:${normalizeRealm(realm)}`,
    "surface:catalog",
  ].join("|");
}

function normalizeVersionToken(versionToken) {
  const trimmed = String(versionToken || "").trim();
  if (!trimmed) return "version-unknown";
  return trimmed.replace(/[^a-zA-Z0-9._:-]+/g, "_");
}

function buildCacheKey(identity, versionToken) {
  return `${identity}|version:${normalizeVersionToken(versionToken)}`;
}

function readCacheEntry(identity) {
  const currentVersionToken = identityVersionIndex.get(identity) || "version-unknown";
  const cacheKey = buildCacheKey(identity, currentVersionToken);
  const entry = cacheEntries.get(cacheKey) || null;

  return {
    cacheKey,
    currentVersionToken,
    entry,
  };
}

function writeCacheEntry(identity, versionToken, value) {
  const nextToken = normalizeVersionToken(versionToken);
  const previousToken = identityVersionIndex.get(identity);
  const nextKey = buildCacheKey(identity, nextToken);

  cacheEntries.set(nextKey, value);
  identityVersionIndex.set(identity, nextToken);

  if (previousToken && previousToken !== nextToken) {
    const previousKey = buildCacheKey(identity, previousToken);
    cacheEntries.delete(previousKey);
  }

  return nextKey;
}

function deriveVersionToken({ etag, version, updatedAt }) {
  const rawEtag = String(etag || "").trim();
  if (rawEtag) {
    return `etag:${rawEtag}`;
  }

  const rawVersion = Number(version);
  const safeVersion = Number.isFinite(rawVersion) ? rawVersion : "na";
  const rawUpdatedAt = String(updatedAt || "").trim() || "na";
  return `v:${safeVersion}|u:${rawUpdatedAt}`;
}

function buildSurfaceSelectionStorageKey({ tenantId, realm }) {
  return [
    SURFACE_SELECTION_STORAGE_PREFIX,
    normalizeTenantId(tenantId),
    normalizeRealm(realm),
  ].join("|");
}

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function readSurfaceSelectionHint({ tenantId, realm }) {
  if (!canUseSessionStorage()) return null;
  try {
    const key = buildSurfaceSelectionStorageKey({ tenantId, realm });
    const value = window.sessionStorage.getItem(key);
    const trimmed = String(value || "").trim();
    return trimmed.length ? trimmed : null;
  } catch {
    return null;
  }
}

function writeSurfaceSelectionHint({ tenantId, realm, surfaceCode }) {
  if (!canUseSessionStorage()) return;
  try {
    const key = buildSurfaceSelectionStorageKey({ tenantId, realm });
    const value = String(surfaceCode || "").trim();
    if (!value) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignore best-effort browser-storage failures
  }
}

export {
  buildCacheKey,
  buildSurfaceCatalogIdentity,
  buildSurfaceIdentity,
  deriveVersionToken,
  readCacheEntry,
  readSurfaceSelectionHint,
  writeCacheEntry,
  writeSurfaceSelectionHint,
};
