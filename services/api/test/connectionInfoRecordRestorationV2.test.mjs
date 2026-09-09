import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BASELINE_REQUIRED_OBJECTS,
  sortMigrationFilenames,
} from "../scripts/migrationLedger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const filename = "v2_0049_zz_kernel_info_record_restoration.sql";
const migration = fs.readFileSync(
  path.resolve(repoRoot, "db/migrations", filename),
  "utf8"
);

test("canonical info_record restoration executes after v2_0049 and before v2_0050", () => {
  const ordered = sortMigrationFilenames([
    "v2_0050_connection_inbound_idempotency_governance.sql",
    filename,
    "v2_0049_connection_auth_boundary_correction.sql",
  ]);

  assert.deepEqual(ordered, [
    "v2_0049_connection_auth_boundary_correction.sql",
    filename,
    "v2_0050_connection_inbound_idempotency_governance.sql",
  ]);
});

test("restored info_record is generic kernel evidence storage with tenant isolation", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS eip_core\.info_record/);
  assert.match(migration, /tenant_id uuid NOT NULL REFERENCES kernel\.tenants/);
  assert.match(migration, /record_type text NOT NULL/);
  assert.match(migration, /payload jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(migration, /attrs jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(migration, /created_by_agent_id uuid REFERENCES eip_core\.agent/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /security\.current_tenant_id\(\)/);
  assert.doesNotMatch(migration, /connection_code text NOT NULL/i);
});

test("migration baseline refuses to treat V2 as complete without canonical info_record", () => {
  assert.ok(BASELINE_REQUIRED_OBJECTS.includes("eip_core.info_record"));
});
