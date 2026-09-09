import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BOOTSTRAP_PERMISSION_CODES,
  mergeBootstrapPermissionCodes,
  normalizePermissionCodes,
} from "../scripts/bootstrapPermissionProfile.mjs";
import {
  parseApply,
  readCanonicalPermissions,
} from "../scripts/repair_owner_admin_permissions.mjs";

test("bootstrap permission profile includes owner admin and connection authority", () => {
  for (const code of [
    "OWNER_ADMIN_CONSOLE_READ",
    "OWNER_ADMIN_ACCESS_READ",
    "OWNER_ADMIN_SECURITY_READ",
    "OWNER_ADMIN_SETTINGS_READ",
    "OWNER_ADMIN_CONNECTION_READ",
    "OWNER_ADMIN_CONNECTION_WRITE",
    "OWNER_ADMIN_CONNECTION_SECRET_MANAGE",
    "OWNER_ADMIN_CONNECTION_TEST",
  ]) {
    assert.ok(DEFAULT_BOOTSTRAP_PERMISSION_CODES.includes(code), `${code} must remain in bootstrap authority`);
  }
});

test("permission merge preserves existing authority and deduplicates normalized additions", () => {
  assert.deepEqual(
    mergeBootstrapPermissionCodes(["custom_read", "OWNER_ADMIN_CONSOLE_READ", "custom_read"]),
    [
      "CUSTOM_READ",
      ...DEFAULT_BOOTSTRAP_PERMISSION_CODES,
    ]
  );
});

test("permission normalization ignores empty values and normalizes case", () => {
  assert.deepEqual(
    normalizePermissionCodes([" owner_admin_console_read ", "", null, "OWNER_ADMIN_CONSOLE_READ"]),
    ["OWNER_ADMIN_CONSOLE_READ"]
  );
});

test("owner admin repair is dry-run unless apply is explicit", () => {
  for (const value of [undefined, null, "", "false", "0", "dry-run", "no"] ) {
    assert.equal(parseApply(value), false);
  }
  for (const value of ["true", "TRUE", "1", "yes", "apply"] ) {
    assert.equal(parseApply(value), true);
  }
});

test("canonical permission reader does not infer legacy buckets", () => {
  assert.deepEqual(readCanonicalPermissions({ permissions: ["A"] }), ["A"]);
  assert.deepEqual(readCanonicalPermissions({ permission_codes: ["B"] }), []);
  assert.deepEqual(readCanonicalPermissions(null), []);
});
