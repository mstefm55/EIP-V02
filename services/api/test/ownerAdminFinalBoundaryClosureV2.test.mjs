import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { platformTargetRequiresSeparateManagement } from "../src/routes/owner_admin_control.js";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const controlSource = read("src/routes/owner_admin_control.js");
const surfaceMigration = read("../../db/migrations/v2_0069_owner_admin_control_surface_closure.sql");
const provisioningGuardMigration = read("../../db/migrations/v2_0071_owner_admin_provisioning_identity_guard.sql");

test("tenant Security cannot target another platform-managed identity", () => {
  assert.equal(
    platformTargetRequiresSeparateManagement(
      ["PLATFORM_TENANT_REQUEST_READ"],
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222"
    ),
    true
  );
});

test("platform operator can still manage their own older sessions and devices", () => {
  const identityId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    platformTargetRequiresSeparateManagement(["PLATFORM_TENANT_REQUEST_READ"], identityId, identityId),
    false
  );
  assert.equal(
    platformTargetRequiresSeparateManagement(["OWNER_ADMIN_SECURITY_WRITE"], identityId, "22222222-2222-4222-8222-222222222222"),
    false
  );
});

test("session and device mutations lock the target identity and enforce platform separation", () => {
  assert.match(controlSource, /FOR UPDATE OF target_session, target_identity/);
  assert.match(controlSource, /FOR UPDATE OF target_device, target_identity/);
  assert.ok(
    controlSource.split("PLATFORM_IDENTITY_MANAGED_SEPARATELY").length - 1 >= 3,
    "Users & Access, session control and device control must all protect platform-managed identities"
  );
});

test("Settings stays tenant-transaction scoped and does not become a secret store", () => {
  assert.match(controlSource, /FROM tenant\.tenant_settings/);
  assert.match(controlSource, /withTenantTransaction\(app\.db, session\.tenant_id/);
  assert.match(surfaceMigration, /Secret credentials remain outside this surface/);
});

test("Audit stays tenant-filtered and Data Catalogue stays metadata-only", () => {
  assert.match(controlSource, /WHERE event\.tenant_id = \$1::uuid/);
  assert.match(controlSource, /FROM information_schema\.columns/);
  assert.match(controlSource, /SCHEMA_CATALOG_ALLOWLIST/);
  assert.match(controlSource, /row_data_exposed: false/);
  assert.match(surfaceMigration, /Data Catalogue/);
  assert.match(surfaceMigration, /never arbitrary row browsing/);
});

test("already-provisioned tenant requests cannot be reassigned to a second tenant", () => {
  assert.match(provisioningGuardMigration, /enforce_tenant_request_provisioning_identity/);
  assert.match(provisioningGuardMigration, /OLD\.tenant_id IS NOT NULL/);
  assert.match(provisioningGuardMigration, /NEW\.tenant_id IS DISTINCT FROM OLD\.tenant_id/);
  assert.match(provisioningGuardMigration, /OLD\.admin_identity_id IS NOT NULL/);
  assert.match(provisioningGuardMigration, /NEW\.admin_identity_id IS DISTINCT FROM OLD\.admin_identity_id/);
  assert.match(provisioningGuardMigration, /provisioning identity must be set or cleared as a complete pair/);
  assert.match(provisioningGuardMigration, /BEFORE UPDATE OF tenant_id, admin_identity_id/);
  assert.doesNotMatch(provisioningGuardMigration, /CREATE\s+TABLE/i);
});
