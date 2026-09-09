import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const migrationPath = path.resolve(
  repoRoot,
  "db/migrations/v2_0053_connection_permission_authority_repair.sql"
);
const source = fs.readFileSync(migrationPath, "utf8");

test("permission authority repair mirrors all runtime-supported permission buckets", () => {
  for (const marker of [
    "-> 'permissions'",
    "-> 'permission_codes'",
    "-> 'permissionCodes'",
    "#> '{authz,permissions}'",
    "#> '{auth,permissions}'",
  ]) {
    assert.ok(source.includes(marker), `missing permission bucket ${marker}`);
  }

  assert.match(source, /jsonb_typeof/);
  assert.match(source, /identity\.is_active = true/);
});

test("permission authority repair keeps the established bounded Owner Admin eligibility set", () => {
  for (const permission of [
    "OWNER_ADMIN_CONSOLE_READ",
    "OWNER_ADMIN_ACCESS_READ",
    "OWNER_ADMIN_SETTINGS_READ",
    "OWNER_ADMIN_SECURITY_READ",
  ]) {
    assert.ok(source.includes(`'${permission}'`), `missing owner-admin authority ${permission}`);
  }
});

test("permission authority repair grants only the dedicated Connections capability family", () => {
  for (const permission of [
    "OWNER_ADMIN_CONNECTION_READ",
    "OWNER_ADMIN_CONNECTION_WRITE",
    "OWNER_ADMIN_CONNECTION_SECRET_MANAGE",
    "OWNER_ADMIN_CONNECTION_TEST",
  ]) {
    assert.ok(source.includes(`'${permission}'`), `missing connection permission ${permission}`);
  }

  assert.doesNotMatch(
    source,
    /PROCESS_DEF_WRITE|PROCESS_INSTANCE_WRITE|TENANT_OVERRIDE|SUPER_ADMIN|OWNER_ADMIN_CONNECTION_DELETE/
  );
});

test("permission authority repair converges only into canonical attrs.permissions", () => {
  assert.match(source, /jsonb_set\([\s\S]*?'\{permissions\}'/);
  assert.doesNotMatch(source, /jsonb_set\([\s\S]*?'\{permission_codes\}'/);
  assert.doesNotMatch(source, /jsonb_set\([\s\S]*?'\{permissionCodes\}'/);
  assert.doesNotMatch(source, /jsonb_set\([\s\S]*?'\{authz,permissions\}'/);
  assert.doesNotMatch(source, /jsonb_set\([\s\S]*?'\{auth,permissions\}'/);
});

test("permission authority repair validates all dedicated capabilities after update", () => {
  assert.match(source, /\?\| ARRAY\[/);
  assert.match(source, /\?& ARRAY\[/);
  assert.match(source, /RAISE EXCEPTION 'v2_0053 failed to align dedicated Connection permissions/);
});
