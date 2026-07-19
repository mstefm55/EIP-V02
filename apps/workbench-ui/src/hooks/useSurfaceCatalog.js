import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiFetchWithMeta, describeApiError } from "../services/apiClient.js";
import {
  buildSurfaceCatalogIdentity,
  deriveVersionToken,
  readCacheEntry,
  writeCacheEntry,
} from "../engine/surfaceCache.js";
import { sanitizeSurfaceCatalogPayload } from "../engine/surfacePayload.js";

function useSurfaceCatalog(options = {}) {
  const enabled = options.enabled !== false;
  const tenantId = options.tenantId || null;
  const realm = options.realm || null;
  const onUnauthenticated =
    typeof options.onUnauthenticated === "function" ? options.onUnauthenticated : null;
  const identity = useMemo(() => buildSurfaceCatalogIdentity({ tenantId, realm }), [realm, tenantId]);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setLoading(false);
      setError(null);
      return { ok: true, skipped: true };
    }

    const endpoint = "/api/eip/ui/surfaces";
    const cached = readCacheEntry(identity).entry;

    setLoading(true);
    setError(null);
    if (Array.isArray(cached?.items)) {
      setItems(cached.items);
    }

    try {
      const headers = cached?.etag ? { "If-None-Match": cached.etag } : {};
      const result = await apiFetchWithMeta(endpoint, { headers });

      if (result.status === 304 && Array.isArray(cached?.items)) {
        setItems(cached.items);
        return { ok: true, cached: true };
      }

      const normalized = sanitizeSurfaceCatalogPayload(result?.data || {});
      const etag = result.headers?.get?.("etag");
      const newestUpdatedAt = normalized.items.reduce((latest, item) => {
        if (!item?.updated_at) return latest;
        if (!latest) return item.updated_at;
        return item.updated_at > latest ? item.updated_at : latest;
      }, null);
      const highestVersion = normalized.items.reduce((maxVersion, item) => {
        const value = Number.isFinite(item?.version) ? item.version : maxVersion;
        return value > maxVersion ? value : maxVersion;
      }, 0);
      const versionToken = deriveVersionToken({
        etag,
        version: highestVersion || normalized.items.length,
        updatedAt: newestUpdatedAt || "catalog",
      });

      writeCacheEntry(identity, versionToken, {
        etag: etag || null,
        items: normalized.items,
      });

      setItems(normalized.items);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setItems([]);
        setError("Session required to discover tenant surfaces.");
        if (onUnauthenticated) {
          Promise.resolve().then(() => onUnauthenticated({ source: "surface_catalog" }));
        }
        return { ok: false, error: "UNAUTHENTICATED" };
      }

      setItems([]);
      setError(describeApiError(err, "Failed to load surface catalog."));
      return { ok: false, error: "SURFACE_CATALOG_LOAD_FAILED" };
    } finally {
      setLoading(false);
    }
  }, [enabled, identity, onUnauthenticated]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    items,
    loading,
    error,
    reload: load,
  };
}

export { useSurfaceCatalog };
