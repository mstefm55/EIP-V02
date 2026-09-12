import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractPermissionCodes } from "../src/security/permissionPolicy.js";
import {
  DEFAULT_BOOTSTRAP_PERMISSION_CODES,
  LEGACY_PLATFORM_PERMISSION_CODES,
  PLATFORM_CONTROL_PERMISSION_CODES,
  buildOwnerAdminPermissionCodes,
} from "../scripts/bootstrapPermissionProfile.mjs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("../../db/migrations/v2_0070_owner_admin_platform_authority_boundary.sql");
const validator = read("../../scripts/validate_tenant_scope.mjs");

test("ordinary Owner Admin bootstrap authority excludes global tenant-request control", () => {
  for (const code of [...LEGACY_PLATFORM_PERMISSION_CODES, ...PLATFORM_CONTROL_PERMISSION_CODES]) {
    assert.equal(
      DEFAULT_BOOTSTRAP_PERMISSION_CODES.includes(code),
      false,
      `${code} must never be part of ordinary tenant Owner Admin defaults`
    );
  }
});

test("legacy leaked tenant-request permissions are inert without explicit platform authority", () => {
  const effective = extractPermissionCodes({
    permissions: [
      "OWNER_ADMIN_CONSOLE_READ",
      "OWNER_ADMIN_TENANT_REQUEST_READ",
      "OWNER_ADMIN_TENANT_REQUEST_WRITE",
    ],
  });

  assert.ok(effective.includes("OWNER_ADMIN_CONSOLE_READ"));
  assert.equal(effective.includes("OWNER_ADMIN_TENANT_REQUEST_READ"), false);
  assert.equal(effective.includes("OWNER_ADMIN_TENANT_REQUEST_WRITE"), false);
});

test("explicit platform permissions bridge to the compatibility route contract", () => {
  const effective = extractPermissionCodes({
    permissions: [
      "PLATFORM_TENANT_REQUEST_READ",
      "PLATFORM_TENANT_REQUEST_WRITE",
    ],
  });

  for (const code of [
    "PLATFORM_TENANT_REQUEST_READ",
    "PLATFORM_TENANT_REQUEST_WRITE",
    "OWNER_ADMIN_TENANT_REQUEST_READ",
    "OWNER_ADMIN_TENANT_REQUEST_WRITE",
  ]) {
    assert.ok(effective.includes(code), `${code} must be effective for an explicit platform operator`);
  }
});

test("Owner Admin repair strips platform authority unless explicitly opted in", () => {
  const existing = [
    "CUSTOM_READ",
    "OWNER_ADMIN_TENANT_REQUEST_READ",
    "OWNER_ADMIN_TENANT_REQUEST_WRITE",
    "PLATFORM_TENANT_REQUEST_READ",
    "PLATFORM_TENANT_REQUEST_WRITE",
  ];

  const ordinary = buildOwnerAdminPermissionCodes(existing);
  assert.ok(ordinary.includes("CUSTOM_READ"));
  for (const code of [...LEGACY_PLATFORM_PERMISSION_CODES, ...PLATFORM_CONTROL_PERMISSION_CODES]) {
    assert.equal(ordinary.includes(code), false, `${code} must be stripped from ordinary repair`);
  }

  const platform = buildOwnerAdminPermissionCodes(existing, { includePlatformControl: true });
  for (const code of PLATFORM_CONTROL_PERMISSION_CODES) {
    assert.ok(platform.includes(code), `${code} must be granted only on explicit platform repair`);
  }
  for (const code of LEGACY_PLATFORM_PERMISSION_CODES) {
    assert.equal(platform.includes(code), false, `${code} must stay retired from canonical identity attrs`);
  }
});

test("v2_0070 fails closed and moves Tenant Requests metadata to platform authority", () => {
  assert.match(migration, /OWNER_ADMIN_TENANT_REQUEST_READ/);
  assert.match(migration, /OWNER_ADMIN_TENANT_REQUEST_WRITE/);
  assert.match(migration, /PLATFORM_TENANT_REQUEST_READ/);
  assert.match(migration, /PLATFORM_TENANT_REQUEST_WRITE/);
  assert.match(migration, /requires_any_permission/);
  assert.match(migration, /explicitly opt the intended platform operator back in/);
});

test("tenant validator permits only the governed pre-tenant submission and guarded global queue", () => {
  assert.match(validator, /tenant_requests_public\.js/);
  assert.match(validator, /owner_admin_control\.js/);
  assert.match(validator, /INSERT\\s\+INTO\\s\+kernel\\\.tenant_request/);
  assert.match(validator, /guardedTenantRequestControlPattern/);
  assert.doesNotMatch(validator, /globallyScopedPattern[^\n]*kernel\\\.tenant_request/);
});
