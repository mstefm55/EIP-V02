import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OWNER_ADMIN_PERMISSION_CODES,
  hasPlatformControlPermissionCodes,
  validateTenantManagedPermissionCodes,
} from "../src/routes/owner_admin_control.js";

const routeSource = readFileSync(new URL("../src/routes/owner_admin_control.js", import.meta.url), "utf8");

const ACTOR_TENANT_PERMISSIONS = [
  "OWNER_ADMIN_CONSOLE_READ",
  "OWNER_ADMIN_ACCESS_READ",
  "OWNER_ADMIN_ACCESS_WRITE",
  "OWNER_ADMIN_SECURITY_READ",
  "OWNER_ADMIN_SECURITY_WRITE",
];

test("new tenant Owner Admin defaults contain no platform or retired global queue authority", () => {
  assert.equal(OWNER_ADMIN_PERMISSION_CODES.some((code) => code.startsWith("PLATFORM_")), false);
  assert.equal(OWNER_ADMIN_PERMISSION_CODES.includes("OWNER_ADMIN_TENANT_REQUEST_READ"), false);
  assert.equal(OWNER_ADMIN_PERMISSION_CODES.includes("OWNER_ADMIN_TENANT_REQUEST_WRITE"), false);
});

test("platform-managed identities are detected from normalized explicit platform permissions", () => {
  assert.equal(hasPlatformControlPermissionCodes([" platform_tenant_request_read "]), true);
  assert.equal(hasPlatformControlPermissionCodes(["OWNER_ADMIN_ACCESS_WRITE"]), false);
});

test("tenant user management accepts normalized permissions already held by the actor", () => {
  const decision = validateTenantManagedPermissionCodes(
    [" owner_admin_access_read ", "OWNER_ADMIN_SECURITY_READ", "OWNER_ADMIN_ACCESS_READ"],
    ACTOR_TENANT_PERMISSIONS
  );

  assert.equal(decision.ok, true);
  assert.equal(decision.error, null);
  assert.deepEqual(decision.permissions, ["OWNER_ADMIN_ACCESS_READ", "OWNER_ADMIN_SECURITY_READ"]);
});

test("tenant user management cannot delegate platform authority even when caller holds it", () => {
  const decision = validateTenantManagedPermissionCodes(
    ["OWNER_ADMIN_ACCESS_READ", "PLATFORM_TENANT_REQUEST_READ"],
    [...ACTOR_TENANT_PERMISSIONS, "PLATFORM_TENANT_REQUEST_READ"]
  );

  assert.equal(decision.ok, false);
  assert.equal(decision.error, "PLATFORM_PERMISSION_ASSIGNMENT_FORBIDDEN");
  assert.deepEqual(decision.forbidden, ["PLATFORM_TENANT_REQUEST_READ"]);
});

test("retired Tenant Request permission names cannot be reintroduced through Users & Access", () => {
  for (const legacyCode of [
    "OWNER_ADMIN_TENANT_REQUEST_READ",
    "OWNER_ADMIN_TENANT_REQUEST_WRITE",
  ]) {
    const decision = validateTenantManagedPermissionCodes(
      [legacyCode],
      [...ACTOR_TENANT_PERMISSIONS, legacyCode]
    );
    assert.equal(decision.ok, false);
    assert.equal(decision.error, "PLATFORM_PERMISSION_ASSIGNMENT_FORBIDDEN");
  }
});

test("tenant administrator cannot grant a permission they do not currently hold", () => {
  const decision = validateTenantManagedPermissionCodes(
    ["OWNER_ADMIN_SETTINGS_WRITE"],
    ACTOR_TENANT_PERMISSIONS
  );

  assert.equal(decision.ok, false);
  assert.equal(decision.error, "PERMISSION_ESCALATION_FORBIDDEN");
  assert.deepEqual(decision.forbidden, ["OWNER_ADMIN_SETTINGS_WRITE"]);
});

test("future platform permission names are fail-closed without a code-specific patch", () => {
  const decision = validateTenantManagedPermissionCodes(
    ["PLATFORM_FUTURE_CONTROL"],
    ["PLATFORM_FUTURE_CONTROL"]
  );

  assert.equal(decision.ok, false);
  assert.equal(decision.error, "PLATFORM_PERMISSION_ASSIGNMENT_FORBIDDEN");
});

test("both tenant user create and update routes validate delegated permissions before persistence", () => {
  assert.match(
    routeSource,
    /const permissionDecision = validateTenantManagedPermissionCodes\(\s*req\.body\?\.permissions,\s*session\.permission_codes\s*\);/
  );
  assert.match(
    routeSource,
    /const permissionDecision = hasPermissions\s*\? validateTenantManagedPermissionCodes\(req\.body\.permissions, session\.permission_codes\)/
  );
  assert.match(
    routeSource,
    /reply\.code\(403\)\.send\(\{ ok: false, error: permissionDecision\.error \}\)/
  );
});

test("tenant Users & Access cannot mutate an identity carrying platform authority", () => {
  assert.match(routeSource, /platform_managed:\s*hasPlatformControlPermissionCodes\(permissions\)/);
  assert.match(
    routeSource,
    /if \(hasPlatformControlPermissionCodes\(row\.attrs\?\.permissions\)\) \{[\s\S]*?PLATFORM_IDENTITY_MANAGED_SEPARATELY/
  );
});
