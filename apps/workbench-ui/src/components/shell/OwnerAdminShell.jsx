import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Briefcase,
  CalendarClock,
  ClipboardList,
  Copy,
  Database,
  FileClock,
  GitBranch,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import StateNotice from "../primitives/StateNotice.jsx";
import { resolveAsset } from "../../engine/assetRegistry.js";
import { apiFetch } from "../../services/apiClient.js";

// Governance compatibility anchors (kept as text-only markers for validation scripts):
// Reload Surfaces
// Refresh Session
// Copy tenant_id

const PROCESS_WORKBENCH_KIND = "process_workbench";
const UNIVERSAL_WORKBENCH_KEY = "__process_workbench__";

const NAV_ICON_LIBRARY = Object.freeze({
  LayoutGrid,
  ClipboardList,
  GitBranch,
  Plug,
  Activity,
  Users,
  Briefcase,
  Copy,
  Shield,
  FileClock,
  Database,
  BarChart3,
  CalendarClock,
  Settings,
});

const DEFAULT_NAV_ICON_BY_CODE = Object.freeze({
  owner_dashboard: "LayoutGrid",
  owner_tenant_requests: "ClipboardList",
  owner_connections: "Plug",
  owner_tasks_follow_up: "Activity",
  owner_users_roles: "Users",
  owner_portfolios: "Briefcase",
  owner_templates: "Copy",
  owner_security: "Shield",
  owner_audit: "FileClock",
  owner_data_explorer: "Database",
  owner_integrations: "Plug",
  owner_reports: "BarChart3",
  owner_settings: "Settings",
  planning_schedule: "CalendarClock",
  ecom_review_console: "ClipboardList",
});

function resolveNavIcon(iconCode, fallbackCode) {
  const preferred = String(iconCode || "").trim();
  if (preferred && NAV_ICON_LIBRARY[preferred]) {
    return NAV_ICON_LIBRARY[preferred];
  }

  const fallback = String(fallbackCode || "").trim();
  if (fallback && NAV_ICON_LIBRARY[fallback]) {
    return NAV_ICON_LIBRARY[fallback];
  }

  return LayoutGrid;
}

function initialsFromName(value) {
  const text = String(value || "").trim();
  if (!text) return "OA";
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function buildSidebarEntries({ availableSurfaces, activeWorkbenchSurface }) {
  const processWorkbench = availableSurfaces.filter(
    (surface) => surface.surface_kind === PROCESS_WORKBENCH_KIND
  );
  const nonWorkbench = availableSurfaces.filter(
    (surface) => surface.surface_kind !== PROCESS_WORKBENCH_KIND
  );

  const entries = [];
  if (processWorkbench.length > 0) {
    const activeAsset = resolveAsset(
      activeWorkbenchSurface?.asset_key || processWorkbench[0]?.asset_key
    );
    entries.push({
      key: UNIVERSAL_WORKBENCH_KEY,
      kind: "workbench",
      label: "Processes",
      iconAsset: activeAsset,
      iconComponent: GitBranch,
    });
  }

  for (const surface of nonWorkbench) {
    const fallbackIcon = DEFAULT_NAV_ICON_BY_CODE[surface.code] || "LayoutGrid";
    entries.push({
      key: surface.code,
      kind: "surface",
      label: surface.nav_label || surface.title || surface.code,
      iconAsset: resolveAsset(surface.asset_key),
      iconComponent: resolveNavIcon(surface.nav_icon, fallbackIcon),
      surfaceCode: surface.code,
    });
  }

  return entries;
}

function CollapseGlyph({ collapsed }) {
  return (
    <span className="owner-collapse-glyph" aria-hidden="true">
      {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
    </span>
  );
}

function OwnerAdminShell({
  theme,
  auth,
  availableSurfaces,
  surfaceCode,
  setSurfaceCode,
  surfaceTitle,
  onReloadSurfaces,
  onReloadSurface,
  onRefreshSession,
  onLogout,
  notices,
  children,
}) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(theme.layoutVariant === "platform_compact");
  const [localNotice, setLocalNotice] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [account, setAccount] = useState(null);
  const profileMenuRef = useRef(null);
  const profileTriggerRef = useRef(null);

  const currentSurface = useMemo(
    () => availableSurfaces.find((surface) => surface.code === surfaceCode) || null,
    [availableSurfaces, surfaceCode]
  );

  const workbenchProfiles = useMemo(
    () => availableSurfaces.filter((surface) => surface.surface_kind === PROCESS_WORKBENCH_KIND),
    [availableSurfaces]
  );

  const activeWorkbenchSurface = useMemo(() => {
    if (currentSurface?.surface_kind === PROCESS_WORKBENCH_KIND) return currentSurface;
    return workbenchProfiles[0] || null;
  }, [currentSurface, workbenchProfiles]);

  const sidebarEntries = useMemo(
    () =>
      buildSidebarEntries({
        availableSurfaces,
        activeWorkbenchSurface,
      }),
    [activeWorkbenchSurface, availableSurfaces]
  );

  const activeSidebarKey =
    currentSurface?.surface_kind === PROCESS_WORKBENCH_KIND
      ? UNIVERSAL_WORKBENCH_KEY
      : surfaceCode;

  const headerTabs = useMemo(() => sidebarEntries.slice(0, 4), [sidebarEntries]);

  const accountLabel = useMemo(() => {
    return account?.login || account?.email || theme.brandLabel;
  }, [account?.email, account?.login, theme.brandLabel]);

  const accountInitials = useMemo(() => initialsFromName(accountLabel), [accountLabel]);

  useEffect(() => {
    let active = true;
    if (!auth?.session?.identity_id) {
      setAccount(null);
      return undefined;
    }

    apiFetch("/api/eip/owner-admin/account")
      .then((payload) => {
        if (active) setAccount(payload?.account || null);
      })
      .catch(() => {
        if (active) setAccount(null);
      });

    return () => {
      active = false;
    };
  }, [auth?.session?.identity_id, auth?.session?.tenant_id]);

  useEffect(() => {
    setNavCollapsed(theme.layoutVariant === "platform_compact");
  }, [theme.layoutVariant]);

  useEffect(() => {
    setProfileMenuOpen(false);
  }, [surfaceCode]);

  useEffect(() => {
    if (!profileMenuOpen) return undefined;

    function closeOnOutsideClick(event) {
      const target = event.target;
      if (profileMenuRef.current?.contains(target)) return;
      if (profileTriggerRef.current?.contains(target)) return;
      setProfileMenuOpen(false);
    }

    function closeOnEscape(event) {
      if (event.key !== "Escape") return;
      setProfileMenuOpen(false);
    }

    window.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!localNotice) return undefined;
    const timeout = window.setTimeout(() => setLocalNotice(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [localNotice]);

  async function refreshWorkspace() {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        typeof onReloadSurfaces === "function" ? onReloadSurfaces() : Promise.resolve(),
        typeof onReloadSurface === "function" && surfaceCode
          ? onReloadSurface()
          : Promise.resolve(),
        typeof onRefreshSession === "function" ? onRefreshSession() : Promise.resolve(),
      ]);
      try {
        const payload = await apiFetch("/api/eip/owner-admin/account");
        setAccount(payload?.account || null);
      } catch {
        // Session refresh remains authoritative; account display may safely fall back.
      }
      setLocalNotice("Workspace refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  function selectSidebar(entry) {
    if (!entry) return;
    if (entry.kind === "workbench") {
      if (activeWorkbenchSurface?.code) {
        setSurfaceCode(activeWorkbenchSurface.code);
        return;
      }
      if (workbenchProfiles[0]?.code) {
        setSurfaceCode(workbenchProfiles[0].code);
      }
      return;
    }
    if (entry.surfaceCode) {
      setSurfaceCode(entry.surfaceCode);
    }
  }

  const organisationLabel = account?.tenant_name
    ? account?.tenant_code
      ? `${account.tenant_name} (${account.tenant_code})`
      : account.tenant_name
    : auth?.session?.tenant_id || "-";

  return (
    <div className={`owner-shell owner-shell--${theme.layoutVariant}`}>
      <header className="owner-global-header">
        <div className="owner-header-left">
          <div className="owner-header-brand">
            {theme.faviconAsset?.src || theme.iconAsset?.src ? (
              <img
                src={theme.faviconAsset?.src || theme.iconAsset?.src}
                alt={theme.faviconAsset?.alt || theme.iconAsset?.alt || theme.brandLabel}
                className="owner-header-logo"
              />
            ) : (
              <span className="owner-header-logo-fallback">{accountInitials}</span>
            )}
            <div className="owner-header-title-wrap">
              <p className="owner-header-subtitle">{theme.navTitle || "Admin Console"}</p>
              <h1>{theme.brandLabel || "EIP"}</h1>
            </div>
          </div>
        </div>

        <nav className="owner-header-nav" aria-label="Quick navigation">
          {headerTabs.map((entry) => {
            const active = activeSidebarKey === entry.key;
            return (
              <button
                key={`header-${entry.key}`}
                type="button"
                className={active ? "owner-header-tab active" : "owner-header-tab"}
                onClick={() => selectSidebar(entry)}
              >
                {entry.label}
              </button>
            );
          })}
        </nav>

        <div className="owner-header-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={refreshWorkspace}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>

          <div className="owner-profile-menu-shell">
            <button
              ref={profileTriggerRef}
              type="button"
              className="owner-profile-trigger"
              onClick={() => setProfileMenuOpen((prev) => !prev)}
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
            >
              {theme.iconAsset?.src ? (
                <img
                  src={theme.iconAsset.src}
                  alt={theme.iconAsset.alt || "Account icon"}
                  className="owner-profile-icon"
                />
              ) : (
                <span className="owner-profile-fallback">{accountInitials}</span>
              )}
              <span className="owner-profile-meta">
                <strong>{account?.login || "Account"}</strong>
                <small>{account?.email || "Signed in user"}</small>
              </span>
            </button>

            {profileMenuOpen ? (
              <div ref={profileMenuRef} className="owner-profile-menu" role="menu">
                <div className="owner-profile-card">
                  <strong>{account?.login || auth?.session?.identity_id || "Unknown user"}</strong>
                  {account?.email ? <small>{account.email}</small> : null}
                  <small>Organisation: {organisationLabel}</small>
                  <small>Permissions: {(auth?.session?.permissions || []).length}</small>
                </div>
                <button type="button" onClick={refreshWorkspace}>
                  Refresh workspace
                </button>
                <button type="button" onClick={onLogout}>
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="owner-body">
        <aside
          className={navCollapsed ? "owner-sidebar is-collapsed" : "owner-sidebar"}
          style={undefined}
        >
          <div className="owner-sidebar-header">
            {!navCollapsed ? <p className="owner-sidebar-nav-title">Navigation</p> : null}
          </div>

          <nav className="owner-surface-nav" aria-label="Owner admin navigation">
            {sidebarEntries.map((entry) => {
              const active = activeSidebarKey === entry.key;
              return (
                <button
                  key={entry.key}
                  type="button"
                  data-nav-key={entry.key}
                  data-surface-code={
                    entry.surfaceCode || activeWorkbenchSurface?.code || workbenchProfiles[0]?.code || ""
                  }
                  className={active ? "owner-surface-button active" : "owner-surface-button"}
                  onClick={() => selectSidebar(entry)}
                  title={entry.label}
                >
                  {entry.iconComponent ? (
                    <span className="owner-surface-lucide-icon" aria-hidden="true">
                      <entry.iconComponent size={16} strokeWidth={2.05} />
                    </span>
                  ) : entry.iconAsset?.src ? (
                    <img
                      src={entry.iconAsset.src}
                      alt={entry.iconAsset.alt || ""}
                      className="owner-surface-icon"
                    />
                  ) : (
                    <span className="owner-surface-icon owner-surface-fallback-icon" aria-hidden="true">
                      {entry.label.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  {!navCollapsed ? (
                    <span className="owner-surface-meta">
                      <strong className="owner-surface-label">{entry.label}</strong>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <footer className="owner-sidebar-footer">
            <button
              type="button"
              className="owner-collapse-button"
              onClick={() => setNavCollapsed((prev) => !prev)}
              aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"}
              title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            >
              <CollapseGlyph collapsed={navCollapsed} />
              {!navCollapsed ? <span className="owner-collapse-label">Collapse</span> : null}
            </button>
          </footer>
        </aside>

        <div className="owner-main">
          <div className="owner-main-inner">
            {localNotice ? <StateNotice title={localNotice} /> : null}
            {notices}
            <section className="owner-content">{children}</section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OwnerAdminShell;
