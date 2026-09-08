import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const migration = fs.readFileSync(
  path.resolve(repoRoot, "db/migrations/v2_0048_connection_live_endpoint_projection.sql"),
  "utf8"
);

test("live endpoint projection stays tenant-safe and contract-backed", () => {
  assert.match(migration, /connection_setup_v2/);
  assert.match(migration, /\/api\/eip\/owner-admin\/connections\/:code\/endpoints/);
  assert.match(migration, /OWNER_ADMIN_CONNECTION_READ/);
  assert.match(migration, /Public intake URL/);
  assert.match(migration, /EDI webhook URL/);
  assert.doesNotMatch(migration, /"path"\s*:\s*"tenant_id"|"key"\s*:\s*"tenant_id"/i);
});

test("live endpoint projection removes stale pre-runtime messaging", () => {
  assert.doesNotMatch(migration, /public inbound gateway runtime is restored/i);
  assert.match(migration, /live transport support/i);
  assert.match(migration, /Process\/Service Object bindings/);
});
