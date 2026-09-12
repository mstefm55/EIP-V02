import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BOOTSTRAP_PERMISSION_CODES,
  LEGACY_PLATFORM_PERMISSION_CODES,
  PLATFORM_CONTROL_PERMISSION_CODES,
  buildOwnerAdminPermissionCodes,
  mergeBootstrapPermissionCodes,
  normalizePermissionCodes,
} from "../scripts/bootstrapPermissionProfile.mjs";
import {
  parseApply,
  readCanonicalPermissions,
} from "../scripts/repair_owner_admin_permissions.mjs";

test("bootstrap permission profile includes tenant Owner Admin and connection authority", () => {
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

  for (const code of [...LEGACY_PLATFORM_PERMISSION_CODES, ...PLATFORM_CONTROL_PERMISSION_CODES]) {
    assert.equal(DEFAULT_BOOTSTRAP_PERMISSION_CODES.includes(code), false, `${code} must not be tenant bootstrap authority`);
  }
});

test("permission merge preserves existing tenant authority and strips restricted platform grants", () => {
  assert.deepEqual(
    mergeBootstrapPermissionCodes([
      "custom_read",
      "OWNER_ADMIN_CONSOLE_READ",
      "custom_read",
      "OWNER_ADMIN_TENANT_REQUEST_READ",
      "PLATFORM_TENANT_REQUEST_WRITE",
    ]),
    [
      "CUSTOM_READ",
      ...DEFAULT_BOOTSTRAP_PERMISSION_CODES,
    ]
  );
});

test("explicit platform repair grants current platform codes without reviving legacy codes", () => {
  const result = buildOwnerAdminPermissionCodes(
    ["OWNER_ADMIN_TENANT_REQUEST_READ", "CUSTOM_READ"],
    { includePlatformControl: true }
  );

  assert.ok(result.includes("CUSTOM_READ"));
  for (const code of PLATFORM_CONTROL_PERMISSION_CODES) assert.ok(result.includes(code));
  for (const code of LEGACY_PLATFORM_PERMISSION_CODES) assert.equal(result.includes(code), false);
});

test("permission normalization ignores empty values and normalizes case", () => {
  assert.deepEqual(
    normalizePermissionCodes([" owner_admin_console_read ", "", null, "OWNER_ADMIN_CONSOLE_READ"]),
    ["OWNER_ADMIN_CONSOLE_READ"]
  );
});

test("owner admin repair is dry-run or non-platform unless flags are explicit", () => {
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
