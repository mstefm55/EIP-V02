import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPermissionDecision,
  extractPermissionCodes,
  normalizePermissionCodes,
} from "../src/security/permissionPolicy.js";

test("normalizePermissionCodes normalizes case and removes duplicates", () => {
  const result = normalizePermissionCodes([
    " process_def_read ",
    "PROCESS_DEF_READ",
    "",
    null,
    "process_instance_write",
  ]);

  assert.deepEqual(result, ["PROCESS_DEF_READ", "PROCESS_INSTANCE_WRITE"]);
});

test("extractPermissionCodes resolves governed keys from identity attrs", () => {
  const attrs = {
    permissions: ["process_def_read"],
    permission_codes: ["PROCESS_INSTANCE_WRITE"],
    authz: { permissions: ["crm_process_def_read"] },
  };

  const result = extractPermissionCodes(attrs);
  assert.deepEqual(result, [
    "PROCESS_DEF_READ",
    "PROCESS_INSTANCE_WRITE",
    "CRM_PROCESS_DEF_READ",
  ]);
});

test("buildPermissionDecision fails closed when required permissions are missing", () => {
  const decision = buildPermissionDecision({
    requiredPermissions: ["PROCESS_DEF_WRITE"],
    grantedPermissions: ["PROCESS_DEF_READ"],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "PERMISSION_REQUIRED");
  assert.deepEqual(decision.requiredPermissions, ["PROCESS_DEF_WRITE"]);
});

test("buildPermissionDecision allows when at least one required code is granted", () => {
  const decision = buildPermissionDecision({
    requiredPermissions: ["PROCESS_DEF_READ", "CRM_PROCESS_DEF_READ"],
    grantedPermissions: ["PROCESS_DEF_READ"],
  });

  assert.equal(decision.ok, true);
  assert.deepEqual(decision.requiredPermissions, [
    "PROCESS_DEF_READ",
    "CRM_PROCESS_DEF_READ",
  ]);
  assert.deepEqual(decision.grantedPermissions, ["PROCESS_DEF_READ"]);
});
