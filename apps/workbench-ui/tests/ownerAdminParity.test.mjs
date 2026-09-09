import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");

function read(relativePath) {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), "utf8");
}

test("owner admin engine keeps parity primitives generic and allowlisted", () => {
  const registry = read("apps/workbench-ui/src/engine/registry.jsx");
  const metricGrid = read("apps/workbench-ui/src/components/primitives/ContractMetricGrid.jsx");
  const noticePanel = read("apps/workbench-ui/src/components/primitives/NoticePanel.jsx");

  assert.match(registry, /ContractMetricGrid/);
  assert.match(registry, /NoticePanel/);
  assert.doesNotMatch(metricGrid, /owner_admin|tenant_requests|security\/sessions/i);
  assert.doesNotMatch(noticePanel, /owner_admin|tenant_requests|users_roles/i);
});

test("owner admin surfaces no longer share the generic module record editor", () => {
  const migration = read("db/migrations/v2_0035_owner_admin_console_parity_reseed.sql");

  assert.doesNotMatch(migration, /\/api\/eip\/owner-admin\/modules\//);
  assert.doesNotMatch(migration, /ContractRecordEditor/);
  assert.match(migration, /ContractMetricGrid/);
  assert.match(migration, /"type": "Tabs"/);
  assert.match(migration, /"type": "SplitLayout"/);
  assert.match(migration, /"type": "NoticePanel"/);
  assert.match(migration, /\/api\/eip\/owner-admin\/security\/sessions/);
  assert.match(migration, /\/api\/eip\/owner-admin\/users/);
});

test("owner admin shell uses governed surface discovery and supports planning icon", () => {
  const shell = read("apps/workbench-ui/src/components/shell/OwnerAdminShell.jsx");

  assert.match(shell, /availableSurfaces/);
  assert.match(shell, /CalendarClock/);
  assert.match(shell, /\/api\/eip\/owner-admin\/account/);
  assert.doesNotMatch(shell, /owner-admin\/modules/);
});

test("owner admin shell visibly projects the authenticated organisation without owning tenant selection", () => {
  const shell = read("apps/workbench-ui/src/components/shell/OwnerAdminShell.jsx");
  const login = read("apps/workbench-ui/src/components/shell/LoginPanel.jsx");

  assert.match(shell, /Building2/);
  assert.match(shell, /Current organisation:/);
  assert.match(shell, /organisationLabel/);
  assert.match(shell, /account\?\.tenant_name/);
  assert.match(shell, /account\?\.tenant_code/);

  assert.match(login, /resolveOrganisations/);
  assert.match(login, /handleOrganisationChange/);
  assert.doesNotMatch(shell, /setTenantId|handleTenantChange|selectTenant|tenantSelector/i);
});

test("owner admin navigation availability is metadata-driven", () => {
  const catalog = read("services/api/src/routes/ui_surface.js");
  const shell = read("apps/workbench-ui/src/components/shell/OwnerAdminShell.jsx");
  const migration = read("db/migrations/v2_0039_owner_admin_console_operational_composition.sql");

  assert.match(catalog, /surface_nav,enabled/);
  assert.match(catalog, /nav_enabled/);
  assert.match(catalog, /nav_hint/);
  assert.match(shell, /surface\.is_enabled === false/);
  assert.match(shell, /entry\.disabled/);
  assert.match(shell, /owner-surface-disabled-note/);
  assert.match(migration, /'owner_tenant_requests', false/);
  assert.match(migration, /'owner_connections', false/);
  assert.match(migration, /'owner_reports', true/);
  assert.match(migration, /\/api\/eip\/owner-admin\/overview/);
  assert.match(migration, /\/api\/eip\/owner-admin\/activity\?limit=50/);
  assert.doesNotMatch(migration, /owner_admin\.[a-z_]+/i);
});
