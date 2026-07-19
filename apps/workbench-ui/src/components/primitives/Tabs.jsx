import { Children, isValidElement, useEffect, useMemo, useState } from "react";

function normalizeText(value) {
  return String(value || "").trim();
}

function humanize(value) {
  return normalizeText(value)
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveIconLabel(icon) {
  const code = normalizeText(icon).toLowerCase();
  if (!code) return "tab";
  if (code.includes("template")) return "template";
  if (code.includes("bind")) return "binding";
  if (code.includes("stream") || code.includes("instance")) return "instance";
  if (code.includes("session")) return "session";
  return "tab";
}

function iconGlyph(label) {
  switch (label) {
    case "template":
      return "T";
    case "binding":
      return "B";
    case "instance":
      return "I";
    case "session":
      return "S";
    default:
      return "P";
  }
}

function Tabs({ node, children, ctx }) {
  const props = node?.props || {};
  const title = normalizeText(props.title) || "Panels";
  const subtitle = normalizeText(props.subtitle);
  const eyebrow = normalizeText(props.eyebrow) || "Tabbed Workspace";
  const emptyMessage = normalizeText(props.empty_message) || "No panels configured.";
  const keepMounted = props.keep_mounted !== false;

  const childEntries = useMemo(() => {
    return Children.toArray(children)
      .filter((child) => isValidElement(child))
      .map((child, index) => ({
        id:
          normalizeText(child?.props?.node?.id) ||
          normalizeText(child?.key) ||
          `tab_child_${index + 1}`,
        element: child,
      }));
  }, [children]);

  const childById = useMemo(() => {
    const map = new Map();
    for (const entry of childEntries) {
      map.set(entry.id, entry.element);
    }
    return map;
  }, [childEntries]);

  const tabs = useMemo(() => {
    const configured = Array.isArray(props.tabs) ? props.tabs : [];
    const normalizedConfigured = configured
      .map((tab, index) => {
        if (!tab || typeof tab !== "object") return null;
        const id = normalizeText(tab.id) || `tab_${index + 1}`;
        const childId = normalizeText(tab.child_id);
        if (!childId || !childById.has(childId)) return null;
        return {
          id,
          childId,
          label: normalizeText(tab.label) || humanize(childId),
          icon: resolveIconLabel(tab.icon || tab.icon_key || ""),
        };
      })
      .filter(Boolean);

    if (normalizedConfigured.length > 0) {
      return normalizedConfigured;
    }

    return childEntries.map((entry, index) => ({
      id: `tab_${index + 1}`,
      childId: entry.id,
      label: humanize(entry.id),
      icon: "tab",
    }));
  }, [props.tabs, childById, childEntries]);

  const defaultTabId = useMemo(() => {
    const requested = normalizeText(props.default_tab_id);
    if (requested && tabs.some((tab) => tab.id === requested)) {
      return requested;
    }
    return tabs[0]?.id || "";
  }, [props.default_tab_id, tabs]);

  const [activeTabId, setActiveTabId] = useState(defaultTabId);
  const bindToWorkbenchPanel = props.bind_to_workbench_panel === true;
  const workbenchPanelTab = bindToWorkbenchPanel
    ? normalizeText(ctx?.workbench?.panelTab)
    : "";
  const setWorkbenchPanelTab =
    bindToWorkbenchPanel && typeof ctx?.workbench?.setPanelTab === "function"
      ? ctx.workbench.setPanelTab
      : null;

  useEffect(() => {
    if (!tabs.length) {
      if (activeTabId) setActiveTabId("");
      return;
    }
    if (!tabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(defaultTabId);
    }
  }, [activeTabId, defaultTabId, tabs]);

  useEffect(() => {
    if (!bindToWorkbenchPanel) return;
    if (!workbenchPanelTab) return;
    if (!tabs.some((tab) => tab.id === workbenchPanelTab)) return;
    if (workbenchPanelTab === activeTabId) return;
    setActiveTabId(workbenchPanelTab);
  }, [activeTabId, bindToWorkbenchPanel, tabs, workbenchPanelTab]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;

  return (
    <section className="card tabs-shell">
      <div className="tabs-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
        {tabs.length > 0 ? (
          <div className="tabs-bar" role="tablist" aria-label={title}>
            {tabs.map((tab) => {
              const active = tab.id === activeTabId;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`${node?.id || "tabs"}-${tab.id}`}
                  className={active ? "tab-button active" : "tab-button"}
                  onClick={() => {
                    setActiveTabId(tab.id);
                    if (setWorkbenchPanelTab) {
                      setWorkbenchPanelTab(tab.id);
                    }
                  }}
                >
                  <span className="tab-icon" aria-hidden="true">
                    {iconGlyph(tab.icon)}
                  </span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {tabs.length === 0 ? <p className="muted">{emptyMessage}</p> : null}

      {tabs.length > 0 && keepMounted
        ? tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                id={`${node?.id || "tabs"}-${tab.id}`}
                role="tabpanel"
                aria-hidden={!active}
                className={active ? "tab-panel" : "tab-panel is-hidden"}
              >
                {childById.get(tab.childId) || null}
              </div>
            );
          })
        : null}

      {tabs.length > 0 && !keepMounted && activeTab ? (
        <div
          id={`${node?.id || "tabs"}-${activeTab.id}`}
          role="tabpanel"
          className="tab-panel"
        >
          {childById.get(activeTab.childId) || null}
        </div>
      ) : null}
    </section>
  );
}

export default Tabs;
