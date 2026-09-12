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

test("Owner Admin users projection keeps Auth Identity separate from linked Agent", () => {
  const route = read("services/api/src/routes/owner_admin_console.js");
  const migration = read("db/migrations/v2_0066_owner_admin_users_access_projection.sql");

  assert.match(route, /eip_auth\.auth_identity_agent/);
  assert.match(route, /eip_core\.agent/);
  assert.match(route, /identity_agent\.is_primary DESC/);
  assert.match(route, /identity_agent\.tenant_id = identity\.tenant_id/);
  assert.match(route, /agent\.tenant_id = identity_agent\.tenant_id/);
  assert.match(route, /agent_linked/);
  assert.match(route, /agent_name/);
  assert.match(route, /agent_type/);

  assert.match(migration, /Users & Access/);
  assert.match(migration, /agent_name/);
  assert.match(migration, /agent_type/);
  assert.match(migration, /Login identity is not the organisational Agent/);
  assert.doesNotMatch(migration, /CREATE TABLE|CREATE SCHEMA/i);
});

test("Owner Admin security overview is tenant scoped and exposes counts only", () => {
  const route = read("services/api/src/routes/owner_admin_console.js");

  assert.match(route, /\/owner-admin\/security\/overview/);
  assert.match(route, /OWNER_ADMIN_SECURITY_READ/);
  assert.match(route, /AS trusted_devices/);
  assert.match(route, /AS untrusted_devices/);
  assert.match(route, /AS revoked_devices/);
  assert.match(route, /AS locked_identities/);
  assert.match(route, /\[session\.tenant_id\]/);

  assert.doesNotMatch(route, /SELECT[\s\S]*device_token_hash/);
  assert.doesNotMatch(route, /SELECT[\s\S]*secret_hash/);
  assert.doesNotMatch(route, /SELECT[\s\S]*csrf_secret_hash/);
});

test("Owner Admin security surface uses only V2 security projections", () => {
  const migration = read("db/migrations/v2_0067_owner_admin_security_posture_upgrade.sql");

  assert.match(migration, /ContractMetricGrid/);
  assert.match(migration, /\/api\/eip\/owner-admin\/security\/overview/);
  assert.match(migration, /\/api\/eip\/owner-admin\/security\/sessions\?limit=100/);
  assert.match(migration, /\/api\/eip\/owner-admin\/security\/devices\?limit=100/);
  assert.doesNotMatch(migration, /recovery\/requests|passkey/i);
  assert.doesNotMatch(migration, /CREATE TABLE|CREATE SCHEMA/i);
});

test("Owner Admin console remains read-only while access authority is unresolved", () => {
  const route = read("services/api/src/routes/owner_admin_console.js");

  assert.doesNotMatch(route, /app\.post\(/);
  assert.doesNotMatch(route, /app\.patch\(/);
  assert.doesNotMatch(route, /app\.put\(/);
  assert.doesNotMatch(route, /app\.delete\(/);
});
