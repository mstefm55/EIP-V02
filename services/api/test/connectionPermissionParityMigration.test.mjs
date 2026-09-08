import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const source = fs.readFileSync(
  path.resolve(repoRoot, "db/migrations/v2_0045_connection_permission_parity_repair.sql"),
  "utf8"
);

test("permission parity includes all canonical owner-admin read authorities", () => {
  for (const permission of [
    "OWNER_ADMIN_CONSOLE_READ",
    "OWNER_ADMIN_ACCESS_READ",
    "OWNER_ADMIN_SETTINGS_READ",
    "OWNER_ADMIN_SECURITY_READ",
  ]) {
    assert.ok(source.includes(`'${permission}'`), `missing owner-admin authority ${permission}`);
  }
});

test("permission parity grants only dedicated connection capabilities", () => {
  for (const permission of [
    "OWNER_ADMIN_CONNECTION_READ",
    "OWNER_ADMIN_CONNECTION_WRITE",
    "OWNER_ADMIN_CONNECTION_SECRET_MANAGE",
    "OWNER_ADMIN_CONNECTION_TEST",
  ]) {
    assert.ok(source.includes(`'${permission}'`), `missing connection permission ${permission}`);
  }
  assert.doesNotMatch(source, /PROCESS_DEF_WRITE|TENANT_OVERRIDE|SUPER_ADMIN|OWNER_ADMIN_CONNECTION_DELETE/);
});
