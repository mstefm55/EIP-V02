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

test("owner admin console route is read-only, tenant-scoped and permission-gated", () => {
  const source = read("services/api/src/routes/owner_admin_console.js");

  assert.match(source, /app\.requirePermission/);
  assert.match(source, /session\.tenant_id/);
  assert.match(source, /OWNER_ADMIN_CONSOLE_READ/);
  assert.match(source, /OWNER_ADMIN_ACCESS_READ/);
  assert.match(source, /OWNER_ADMIN_SECURITY_READ/);
  assert.match(source, /OWNER_ADMIN_SETTINGS_READ/);
  assert.doesNotMatch(source, /app\.post\(/);
  assert.doesNotMatch(source, /app\.patch\(/);
  assert.doesNotMatch(source, /app\.delete\(/);
});

test("owner admin projections never expose credential or session secret material", () => {
  const source = read("services/api/src/routes/owner_admin_console.js");

  assert.doesNotMatch(source, /secret_hash/);
  assert.doesNotMatch(source, /csrf_secret_hash/);
  assert.doesNotMatch(source, /device_token_hash/);
  assert.doesNotMatch(source, /otp_hash/);
});

test("bootstrap seed no longer creates fake owner admin service objects", () => {
  const seed = read("services/api/scripts/bootstrap_v2_auth_seed.mjs");
  const server = read("services/api/src/server.js");

  assert.doesNotMatch(seed, /OWNER_ADMIN_BOOTSTRAP_RECORDS/);
  assert.doesNotMatch(seed, /owner_admin\./);
  assert.match(seed, /OWNER_ADMIN_CONSOLE_READ/);
  assert.match(server, /owner_admin_console\.js/);
  assert.doesNotMatch(server, /owner_admin_modules\.js/);
});
