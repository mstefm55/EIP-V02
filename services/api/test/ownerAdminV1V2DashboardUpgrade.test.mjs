import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "../..");

function read(relativePath) {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), "utf8");
}

const migrationPath = "db/migrations/v2_0064_owner_admin_dashboard_v1_ux_upgrade.sql";

test("V1 admin dashboard UX upgrade stays on truthful V2 data contracts", () => {
  const migration = read(migrationPath);

  assert.match(migration, /owner_admin_dashboard_v2/);
  assert.match(migration, /ContractMetricGrid/);
  assert.match(migration, /ContractTablePanel/);
  assert.match(migration, /SplitLayout/);
  assert.match(migration, /\/api\/eip\/owner-admin\/overview/);
  assert.match(migration, /\/api\/eip\/owner-admin\/tasks\?limit=12/);
  assert.match(migration, /\/api\/eip\/owner-admin\/activity\?limit=12/);

  assert.doesNotMatch(migration, /Total Transactions/i);
  assert.doesNotMatch(migration, /EDI-54|PARTNER-ERP|TenantX|12\.5k|0\.42%|38 ms/);
  assert.doesNotMatch(migration, /CREATE TABLE/i);
});

test("dashboard upgrade does not introduce a parallel owner-admin runtime", () => {
  const migration = read(migrationPath);
  const route = read("services/api/src/routes/owner_admin_console.js");

  assert.match(route, /session\.tenant_id/);
  assert.match(route, /OWNER_ADMIN_CONSOLE_READ/);
  assert.doesNotMatch(migration, /owner_admin\.[a-z_]+/i);
  assert.doesNotMatch(migration, /tenant_id[^\n]*\$|tenantId/);
});

test("dashboard upgrade uses generic registered workbench primitives", () => {
  const migration = read(migrationPath);
  const registry = read("apps/workbench-ui/src/engine/registry.jsx");

  for (const primitive of ["ContractMetricGrid", "ContractTablePanel", "SplitLayout", "PanelHeader"]) {
    assert.match(migration, new RegExp(`\\"type\\": \\"${primitive}\\"`));
    assert.match(registry, new RegExp(primitive));
  }
});
