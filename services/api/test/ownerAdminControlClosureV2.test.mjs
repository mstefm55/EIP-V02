import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const serverSource = read("src/server.js");
const controlSource = read("src/routes/owner_admin_control.js");
const bootstrapSource = read("src/routes/tenant_bootstrap_public.js");
const publicRequestSource = read("src/routes/tenant_requests_public.js");
const migration = read("../../db/migrations/v2_0069_owner_admin_control_surface_closure.sql");
const workbenchEntry = read("../../apps/workbench-ui/src/main.jsx");

test("Owner Admin control and bootstrap routes are registered", () => {
  assert.match(serverSource, /ownerAdminControlRoutes/);
  assert.match(serverSource, /tenantBootstrapPublicRoutes/);
  assert.match(serverSource, /register\(ownerAdminControlRoutes, \{ prefix: "\/api\/eip" \}\)/);
  assert.match(serverSource, /register\(tenantBootstrapPublicRoutes, \{ prefix: "\/api\/public" \}\)/);
});

test("public access requests persist into the governed pre-tenant queue", () => {
  assert.match(publicRequestSource, /INSERT INTO kernel\.tenant_request/);
  assert.match(publicRequestSource, /'SUBMITTED'/);
  assert.doesNotMatch(publicRequestSource, /INSERT INTO eip_core\.service_object/);
});

test("privileged Owner Admin writes require permission, CSRF and strong assurance", () => {
  assert.match(controlSource, /app\.requirePermission/);
  assert.match(controlSource, /app\.requireCsrf/);
  assert.match(controlSource, /STRONG_ASSURANCE\.has/);
  assert.match(controlSource, /OWNER_ADMIN_ACCESS_WRITE/);
  assert.match(controlSource, /OWNER_ADMIN_SECURITY_WRITE/);
  assert.match(controlSource, /OWNER_ADMIN_SETTINGS_WRITE/);
  assert.match(controlSource, /OWNER_ADMIN_TENANT_REQUEST_WRITE/);
});

test("expired bootstrap links remain recoverable through resend instead of creating a second tenant", () => {
  assert.match(bootstrapSource, /BOOTSTRAP_TOKEN_EXPIRED/);
  assert.match(bootstrapSource, /Keep the governed request in BOOTSTRAP_PENDING/);
  assert.doesNotMatch(bootstrapSource, /SET status_code = 'EXPIRED'/);
  assert.match(migration, /v2_0069_expired_bootstrap_recovery/);
  assert.match(migration, /status_code = 'BOOTSTRAP_PENDING'/);
});

test("the public workbench entrypoint renders activation links before authenticated App", () => {
  assert.match(workbenchEntry, /bootstrap_token/);
  assert.match(workbenchEntry, /TenantBootstrapPanel/);
  assert.match(workbenchEntry, /returnToLogin/);
});

test("Owner Admin core surfaces bind to governed server-scoped control contracts", () => {
  for (const surface of [
    "owner_tenant_requests",
    "owner_users_roles",
    "owner_security",
    "owner_settings",
    "owner_audit",
    "owner_data_explorer",
  ]) {
    assert.match(migration, new RegExp(surface));
  }

  for (const contract of [
    "/owner-admin/control/tenant-requests",
    "/owner-admin/control/users",
    "/owner-admin/control/security/sessions",
    "/owner-admin/control/security/devices",
    "/owner-admin/control/settings",
    "/owner-admin/control/audit",
    "/owner-admin/control/schema-catalog",
  ]) {
    assert.ok(migration.includes(contract), `missing control contract ${contract}`);
  }

  assert.match(migration, /raw browser tenant authority detected/);
  assert.doesNotMatch(migration, /\/owner-admin\/control\/[^"']*\?tenant_id=/);
});

test("Data Catalogue stays metadata-only rather than exposing arbitrary tenant rows", () => {
  assert.match(controlSource, /row_data_exposed: false/);
  assert.match(controlSource, /information_schema\.columns/);
  assert.match(migration, /Schema inspection only/);
});
