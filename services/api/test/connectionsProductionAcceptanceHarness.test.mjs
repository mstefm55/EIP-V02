import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const scriptPath = path.join(apiRoot, "scripts", "accept_connections_production.mjs");
const source = fs.readFileSync(scriptPath, "utf8");

function run(extraEnv = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: apiRoot,
    env: {
      ...process.env,
      CONNECTION_ACCEPTANCE_APPLY: "",
      CONNECTION_ACCEPTANCE_RUN_ID: "",
      CONNECTION_ACCEPTANCE_ADMIN_TENANT_CODE: "",
      CONNECTION_ACCEPTANCE_ADMIN_LOGIN: "",
      CONNECTION_ACCEPTANCE_TARGET_TENANT_CODE: "",
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

test("production Connections acceptance is inert unless explicitly enabled", () => {
  const result = run();
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.skipped, true);
  assert.equal(payload.reason, "CONNECTION_ACCEPTANCE_APPLY_NOT_TRUE");
});

test("production Connections acceptance fails closed before database access without explicit operator scope", () => {
  const result = run({ CONNECTION_ACCEPTANCE_APPLY: "true" });
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /CONNECTION_ACCEPTANCE_RUN_ID is required/);
});

test("acceptance harness covers the remaining live Connections closure gates", () => {
  for (const expected of [
    "OWNER_ADMIN_CONNECTION_READ",
    "OWNER_ADMIN_CONNECTION_WRITE",
    "OWNER_ADMIN_CONNECTION_SECRET_MANAGE",
    "OWNER_ADMIN_CONNECTION_TEST",
    "connection_setup_v2",
    "hide_on_create",
    "CONNECTION_ACTIVATION_BLOCKED",
    "ACTIVATION_CREDENTIAL_REQUIRED",
    "api-key/generate",
    "CONNECTION_SECRET_REQUIRED_BY_ACTIVE_PROFILE",
    "DUPLICATE_SUPPRESSED",
    "idempotency conflict",
    "cluster-safe inbound rate limit",
    "mapped inbound Process dispatch",
    "process_def_id: bogusProcessId",
    "cross-tenant Connection read",
    "cross-tenant Connection write",
    "cross-tenant Connection test",
    "cross-tenant public gateway route",
    "credentials_revoked_on_delete",
  ]) {
    assert.ok(source.includes(expected), `acceptance harness is missing ${expected}`);
  }

  assert.match(source, /assurance:\s*"totp"/);
  assert.match(source, /refusing to mutate a non-v2seed tenant/);
  assert.match(source, /setting_status = 'deprecated'/);
  assert.doesNotMatch(source, /process\.stdout\.write\([^)]*rawKey/s);
});
