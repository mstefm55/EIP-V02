import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetchWithMeta, describeApiError } from "../services/apiClient.js";
import {
  buildSurfaceIdentity,
  deriveVersionToken,
  readCacheEntry,
  writeCacheEntry,
} from "../engine/surfaceCache.js";
import { sanitizeSurfacePayload } from "../engine/surfacePayload.js";

function useSurfaceLoader(surfaceCode, options = {}) {
  const enabled = options.enabled !== false;
  const tenantId = options.tenantId || null;
  const realm = options.realm || null;
  const onUnauthenticated =
    typeof options.onUnauthenticated === "function" ? options.onUnauthenticated : null;
  const [surface, setSurface] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!enabled || !surfaceCode) {
      setSurface(null);
      setLoading(false);
      setError(null);
      return { ok: true, skipped: true };
    }

    const endpoint = `/api/eip/ui/surfaces/${encodeURIComponent(surfaceCode)}`;
    const identity = buildSurfaceIdentity({ tenantId, realm, surfaceCode });
    const cached = readCacheEntry(identity).entry;

    setLoading(true);
    setError(null);
    if (cached?.surface?.tree) {
      setSurface(cached.surface);
    }

    try {
      const headers = cached?.etag ? { "If-None-Match": cached.etag } : {};
      const result = await apiFetchWithMeta(endpoint, { headers });
      if (result.status === 304 && cached?.surface) {
        setSurface(cached.surface);
        return { ok: true, cached: true };
      }

      const nextSurface = sanitizeSurfacePayload(result?.data?.surface || null);
      if (!nextSurface?.tree) {
        setSurface(null);
        setError("Surface payload is missing a valid tree.");
        return { ok: false, error: "SURFACE_INVALID" };
      }

      const etag = result.headers?.get?.("etag");
      const versionToken = deriveVersionToken({
        etag,
        version: nextSurface.version,
        updatedAt: nextSurface.updated_at || nextSurface.created_at,
      });

      writeCacheEntry(identity, versionToken, {
        surface: nextSurface,
        etag: etag || null,
      });

      setSurface(nextSurface);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSurface(null);
        setError("Session required to load this workbench surface.");
        if (onUnauthenticated) {
          Promise.resolve().then(() => onUnauthenticated({ source: "surface_loader" }));
        }
        return { ok: false, error: "UNAUTHENTICATED" };
      }

      setSurface(null);
      setError(describeApiError(err, "Failed to load surface."));
      return { ok: false, error: "SURFACE_LOAD_FAILED" };
    } finally {
      setLoading(false);
    }
  }, [enabled, onUnauthenticated, realm, surfaceCode, tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    surface,
    loading,
    error,
    reload: load,
  };
}

export { useSurfaceLoader };
