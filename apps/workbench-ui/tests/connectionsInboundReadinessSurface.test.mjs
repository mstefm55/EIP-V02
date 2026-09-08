import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const migration = fs.readFileSync(
  path.resolve(repoRoot, "db/migrations/v2_0047_connection_inbound_readiness_surface.sql"),
  "utf8"
);

test("inbound readiness is exposed through the dedicated test permission and tenant-safe contract", () => {
  assert.match(migration, /OWNER_ADMIN_CONNECTION_TEST/);
  assert.match(migration, /\/api\/eip\/owner-admin\/connections\/:code\/test\/inbound-readiness/);
  assert.doesNotMatch(migration, /"path"\s*:\s*"tenant_id"|"key"\s*:\s*"tenant_id"/i);
});

test("inbound readiness does not falsely claim the public runtime exists", () => {
  assert.match(migration, /configuration check until the public inbound gateway runtime is restored/i);
  assert.match(migration, /runtime_status/);
  assert.match(migration, /Configuration readiness is distinct from live inbound runtime availability/);
});
