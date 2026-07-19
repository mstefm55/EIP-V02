import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EngineRenderer } from "./engine/renderer.jsx";
import { registry } from "./engine/registry.jsx";
import { resolveAsset } from "./engine/assetRegistry.js";
import {
  readSurfaceSelectionHint,
  writeSurfaceSelectionHint,
} from "./engine/surfaceCache.js";
import {
  buildThemeCssVariables,
  resolveOwnerAdminTheme,
} from "./engine/themeGovernance.js";
import { useAuthSession } from "./hooks/useAuthSession.js";
import { useSurfaceCatalog } from "./hooks/useSurfaceCatalog.js";
import { useSurfaceLoader } from "./hooks/useSurfaceLoader.js";
import LoginPanel from "./components/shell/LoginPanel.jsx";
import OwnerAdminShell from "./components/shell/OwnerAdminShell.jsx";
import StateNotice from "./components/primitives/StateNotice.jsx";

function readRequestedSurfaceCode() {
  const params = new URLSearchParams(window.location.search);
  const requested = String(params.get("surface") || "").trim();
  return requested.length ? requested : null;
}

function syncSurfaceQueryParam(surfaceCode) {
  const url = new URL(window.location.href);
  if (surfaceCode) {
    url.searchParams.set("surface", surfaceCode);
  } else {
    url.searchParams.delete("surface");
  }
  window.history.replaceState({}, "", url);
}

function pickSurfaceCode({
  currentSurfaceCode,
  requestedSurfaceCode,
  hintedSurfaceCode,
  surfaces,
}) {
  const codes = new Set(surfaces.map((surface) => surface.code));
  const isAllowed = (code) => Boolean(code && codes.has(code));

  if (isAllowed(currentSurfaceCode)) return currentSurfaceCode;
  if (isAllowed(requestedSurfaceCode)) return requestedSurfaceCode;
  if (isAllowed(hintedSurfaceCode)) return hintedSurfaceCode;

  const metadataDefault = surfaces.find((surface) => surface.is_default)?.code;
  if (isAllowed(metadataDefault)) return metadataDefault;
  return surfaces[0]?.code || null;
}

function applyFavicon(iconSrc) {
  if (typeof document === "undefined") return;
  const existing = document.querySelector('link[data-eip-favicon="true"]');
  const href = String(iconSrc || "").trim();

  if (!href) {
    if (existing) existing.remove();
    return;
  }

  const link = existing || document.createElement("link");
  link.setAttribute("data-eip-favicon", "true");
  link.rel = "icon";
  link.type = "image/png";
  const cacheVersion = "v2-20260405";
  link.href = `${href}${href.includes("?") ? "&" : "?"}v=${cacheVersion}`;
  if (!existing) document.head.appendChild(link);
}

function App() {
  const auth = useAuthSession();
  const unauthRefreshInFlightRef = useRef(false);
  const [requestedSurfaceCode] = useState(readRequestedSurfaceCode);
  const [surfaceCode, setSurfaceCodeState] = useState(null);
  const [workbenchRefreshNonce, setWorkbenchRefreshNonce] = useState(0);
  const [workbenchPanelTab, setWorkbenchPanelTab] = useState("");
  const [selection, setSelection] = useState({
    definition: null,
    detail: null,
  });
  const tenantId = auth.session?.tenant_id || null;
  const realm = auth.session?.realm || null;
  const handleUnauthenticatedSurfaceAccess = useCallback(() => {
    if (unauthRefreshInFlightRef.current) return;
    unauthRefreshInFlightRef.current = true;
    Promise.resolve(auth.refresh()).finally(() => {
      unauthRefreshInFlightRef.current = false;
    });
  }, [auth.refresh]);

  const surfaceCatalog = useSurfaceCatalog({
    enabled: auth.authenticated,
    tenantId,
    realm,
    onUnauthenticated: handleUnauthenticatedSurfaceAccess,
  });

  const availableSurfaces = surfaceCatalog.items;
  const allowedSurfaceCodes = useMemo(() => {
    return new Set(availableSurfaces.map((surface) => surface.code));
  }, [availableSurfaces]);

  const setSurfaceCode = useCallback((nextCode) => {
    if (!nextCode || !allowedSurfaceCodes.has(nextCode)) return;
    setSurfaceCodeState(nextCode);
  }, [allowedSurfaceCodes]);

  const selectDefinition = useCallback((definition) => {
    setSelection({ definition: definition || null, detail: null });
  }, []);

  const setDefinitionDetail = useCallback((detail) => {
    setSelection((prev) => ({ ...prev, detail: detail || null }));
  }, []);

  const clearSelection = useCallback(() => {
    setSelection({ definition: null, detail: null });
  }, []);

  const requestWorkbenchRefresh = useCallback(() => {
    setWorkbenchRefreshNonce((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!auth.authenticated) {
      setSurfaceCodeState(null);
      syncSurfaceQueryParam(null);
      return;
    }

    if (surfaceCatalog.loading || surfaceCatalog.error) return;
    if (!availableSurfaces.length) {
      setSurfaceCodeState(null);
      return;
    }

    const hintedSurfaceCode = readSurfaceSelectionHint({ tenantId, realm });
    const nextSurfaceCode = pickSurfaceCode({
      currentSurfaceCode: surfaceCode,
      requestedSurfaceCode,
      hintedSurfaceCode,
      surfaces: availableSurfaces,
    });

    if (nextSurfaceCode && nextSurfaceCode !== surfaceCode) {
      setSurfaceCodeState(nextSurfaceCode);
    }
  }, [
    auth.authenticated,
    availableSurfaces,
    realm,
    requestedSurfaceCode,
    surfaceCatalog.error,
    surfaceCatalog.loading,
    surfaceCode,
    tenantId,
  ]);

  useEffect(() => {
    if (!auth.authenticated || !surfaceCode) return;
    syncSurfaceQueryParam(surfaceCode);
    writeSurfaceSelectionHint({
      tenantId,
      realm,
      surfaceCode,
    });
  }, [auth.authenticated, realm, surfaceCode, tenantId]);

  useEffect(() => {
    clearSelection();
    setWorkbenchPanelTab("");
  }, [clearSelection, surfaceCode]);

  useEffect(() => {
    if (!auth.authenticated) {
      clearSelection();
    }
  }, [auth.authenticated, clearSelection]);

  const surfaceState = useSurfaceLoader(surfaceCode, {
    enabled: auth.authenticated && Boolean(surfaceCode),
    tenantId,
    realm,
    onUnauthenticated: handleUnauthenticatedSurfaceAccess,
  });

  const ctx = useMemo(() => ({
    surfaceCode,
    setSurfaceCode,
    availableSurfaces,
    surfaceProps: surfaceState.surface?.tree?.props || {},
    surfaceMeta: surfaceState.surface?.attrs || {},
    auth,
    selection: {
      definition: selection.definition,
      detail: selection.detail,
      selectDefinition,
      setDefinitionDetail,
      clear: clearSelection,
    },
    workbench: {
      refreshNonce: workbenchRefreshNonce,
      refresh: requestWorkbenchRefresh,
      panelTab: workbenchPanelTab,
      setPanelTab: setWorkbenchPanelTab,
    },
  }), [
    auth,
    clearSelection,
    requestWorkbenchRefresh,
    selectDefinition,
    selection.definition,
    selection.detail,
    setDefinitionDetail,
    setSurfaceCode,
    surfaceCode,
    availableSurfaces,
    surfaceState.surface,
    workbenchPanelTab,
    workbenchRefreshNonce,
  ]);

  const ownerTheme = useMemo(() => {
    return resolveOwnerAdminTheme(
      surfaceState.surface?.shell_theme || {},
      resolveAsset
    );
  }, [surfaceState.surface?.shell_theme]);

  useEffect(() => {
    const title = surfaceState.surface?.title || "Owner Admin Console";
    document.title = `${ownerTheme.brandLabel} | ${title}`;
    applyFavicon(ownerTheme.faviconAsset?.src || ownerTheme.iconAsset?.src || "");
  }, [
    ownerTheme.brandLabel,
    ownerTheme.faviconAsset?.src,
    ownerTheme.iconAsset?.src,
    surfaceState.surface?.title,
  ]);

  if (auth.loading && !auth.authenticated) {
    return (
      <section className="login-shell">
        <div className="card login-card">
          <StateNotice title="Checking session..." />
        </div>
      </section>
    );
  }

  if (!auth.authenticated) {
    return (
      <LoginPanel
        onLogin={auth.login}
        onRequestOtp={auth.requestOtp}
        onLoginWithOtp={auth.loginWithOtp}
        onLoginWithTotp={auth.loginWithTotp}
        onBootstrapTotp={auth.bootstrapTotp}
        onRequestAccess={auth.requestAccess}
        loading={auth.loading}
        error={auth.error}
      />
    );
  }

  const showSurfaceLoadingNotice = surfaceState.loading && !surfaceState.surface;
  const showCatalogLoadingNotice = surfaceCatalog.loading && availableSurfaces.length === 0;

  const notices = (
    <>
      {showSurfaceLoadingNotice ? (
        <StateNotice title="Loading workspace..." />
      ) : null}
      {showCatalogLoadingNotice ? (
        <StateNotice title="Loading available pages..." />
      ) : null}
      {surfaceCatalog.error ? (
        <StateNotice kind="error" title="Unable to load pages" message={surfaceCatalog.error} />
      ) : null}
      {!surfaceCatalog.loading && !surfaceCatalog.error && availableSurfaces.length === 0 ? (
        <StateNotice
          kind="warning"
          title="No pages available"
          message="No published pages are available for this account yet."
        />
      ) : null}
      {surfaceState.error ? (
        <StateNotice kind="error" title="Unable to open page" message={surfaceState.error} />
      ) : null}
    </>
  );

  return (
    <div className="app-shell owner-theme-root" style={buildThemeCssVariables(ownerTheme)}>
      <OwnerAdminShell
        theme={ownerTheme}
        auth={auth}
        availableSurfaces={availableSurfaces}
        surfaceCode={surfaceCode}
        setSurfaceCode={setSurfaceCode}
        surfaceTitle={surfaceState.surface?.title || "Rendered Workbench Surface"}
        onReloadSurfaces={surfaceCatalog.reload}
        onReloadSurface={surfaceState.reload}
        onRefreshSession={auth.refresh}
        onLogout={auth.logout}
        notices={notices}
      >
        {!surfaceState.loading && !surfaceState.error && surfaceState.surface?.tree ? (
          <EngineRenderer surface={surfaceState.surface} registry={registry} ctx={ctx} />
        ) : null}
      </OwnerAdminShell>
    </div>
  );
}

export default App;
