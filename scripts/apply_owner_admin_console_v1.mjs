#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function edit(relativePath, transforms) {
  const file = path.join(root, relativePath);
  let source = fs.readFileSync(file, "utf8");
  for (const { label, before, after } of transforms) {
    if (source.includes(after)) continue;
    const index = source.indexOf(before);
    if (index === -1) throw new Error(`${relativePath}:${label}:NOT_FOUND`);
    if (source.indexOf(before, index + before.length) !== -1) {
      throw new Error(`${relativePath}:${label}:NOT_UNIQUE`);
    }
    source = source.slice(0, index) + after + source.slice(index + before.length);
  }
  fs.writeFileSync(file, source);
}

edit("services/api/src/routes/ui_surface.js", [
  {
    label: "catalog nav availability projection",
    before: `        nullif(attrs#>>'{surface_nav,icon}', '') AS nav_icon,\n        nullif(attrs->>'module', '') AS module,`,
    after: `        nullif(attrs#>>'{surface_nav,icon}', '') AS nav_icon,\n        CASE\n          WHEN lower(COALESCE(attrs#>>'{surface_nav,enabled}', 'true')) IN ('0', 'false', 'no', 'off')\n            THEN false\n          ELSE true\n        END AS nav_enabled,\n        nullif(attrs#>>'{surface_nav,hint}', '') AS nav_hint,\n        nullif(attrs->>'module', '') AS module,`
  },
  {
    label: "catalog select nav availability",
    before: `      nav_icon,\n      module,`,
    after: `      nav_icon,\n      nav_enabled,\n      nav_hint,\n      module,`
  },
  {
    label: "catalog dto nav availability",
    before: `    nav_icon: row.nav_icon || null,\n    module: row.module || null,`,
    after: `    nav_icon: row.nav_icon || null,\n    is_enabled: row.nav_enabled !== false,\n    nav_hint: row.nav_hint || null,\n    module: row.module || null,`
  }
]);

edit("apps/workbench-ui/src/components/shell/OwnerAdminShell.jsx", [
  {
    label: "workbench nav availability defaults",
    before: `      iconComponent: GitBranch,\n    });`,
    after: `      iconComponent: GitBranch,\n      disabled: false,\n      hint: null,\n    });`
  },
  {
    label: "surface nav availability",
    before: `      iconComponent: resolveNavIcon(surface.nav_icon, fallbackIcon),\n      surfaceCode: surface.code,`,
    after: `      iconComponent: resolveNavIcon(surface.nav_icon, fallbackIcon),\n      surfaceCode: surface.code,\n      disabled: surface.is_enabled === false,\n      hint: surface.nav_hint || null,`
  },
  {
    label: "quick nav excludes disabled",
    before: `  const headerTabs = useMemo(() => sidebarEntries.slice(0, 4), [sidebarEntries]);`,
    after: `  const headerTabs = useMemo(\n    () => sidebarEntries.filter((entry) => !entry.disabled).slice(0, 4),\n    [sidebarEntries]\n  );`
  },
  {
    label: "disabled nav selection guard",
    before: `  function selectSidebar(entry) {\n    if (!entry) return;`,
    after: `  function selectSidebar(entry) {\n    if (!entry || entry.disabled) return;`
  },
  {
    label: "header disabled support",
    before: `                className={active ? "owner-header-tab active" : "owner-header-tab"}\n                onClick={() => selectSidebar(entry)}\n              >`,
    after: `                className={active ? "owner-header-tab active" : "owner-header-tab"}\n                onClick={() => selectSidebar(entry)}\n                disabled={entry.disabled}\n                title={entry.hint || entry.label}\n              >`
  },
  {
    label: "sidebar disabled support",
    before: `                  className={active ? "owner-surface-button active" : "owner-surface-button"}\n                  onClick={() => selectSidebar(entry)}\n                  title={entry.label}\n                >`,
    after: `                  className={active ? "owner-surface-button active" : "owner-surface-button"}\n                  onClick={() => selectSidebar(entry)}\n                  disabled={entry.disabled}\n                  aria-disabled={entry.disabled ? "true" : undefined}\n                  title={entry.disabled && entry.hint ? entry.label + " — " + entry.hint : entry.label}\n                >`
  },
  {
    label: "sidebar unavailable label",
    before: `                      <strong className="owner-surface-label">{entry.label}</strong>\n                    </span>`,
    after: `                      <strong className="owner-surface-label">{entry.label}</strong>\n                      {entry.disabled ? (\n                        <small className="owner-surface-disabled-note">Unavailable</small>\n                      ) : null}\n                    </span>`
  }
]);

const stylesPath = path.join(root, "apps/workbench-ui/src/styles.css");
let styles = fs.readFileSync(stylesPath, "utf8");
const marker = `\n/* Owner/Admin governed unavailable navigation state */\n.owner-surface-button:disabled {\n  opacity: 0.52;\n  cursor: not-allowed;\n}\n.owner-surface-button:disabled:hover {\n  transform: none;\n}\n.owner-surface-disabled-note {\n  display: block;\n  margin-top: 0.1rem;\n  font-size: 0.62rem;\n  font-weight: 600;\n  letter-spacing: 0.035em;\n  color: var(--oa-text-muted);\n}\n`;
if (!styles.includes("Owner/Admin governed unavailable navigation state")) {
  styles += marker;
  fs.writeFileSync(stylesPath, styles);
}

console.log("Owner/Admin console generic navigation repair applied.");
