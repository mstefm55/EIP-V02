import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const migration = fs.readFileSync(
  path.resolve(repoRoot, "db/migrations/v2_0049_connection_auth_boundary_correction.sql"),
  "utf8"
);

test("inbound OAuth JWT is deactivated without rewriting EIP auth", () => {
  assert.match(migration, /CONNECTION_VERIFICATION_MODE/);
  assert.match(migration, /oauth2_jwt/);
  assert.match(migration, /is_active = false/);
  assert.match(migration, /not_an_eip_inbound_auth_mode/);
  assert.doesNotMatch(migration, /ALTER\s+TABLE\s+eip_auth\./i);
  assert.doesNotMatch(migration, /UPDATE\s+eip_auth\./i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+eip_auth\./i);
});

test("outbound OAuth client credentials remain available for third-party providers", () => {
  assert.match(migration, /CONNECTION_AUTH_MODE/);
  assert.match(migration, /oauth2_client_credentials/);
  assert.match(migration, /must preserve outbound OAuth2 client credentials/);
});

test("Connections UI removes inbound JWT fields but keeps the metadata-driven security step", () => {
  assert.match(migration, /verification\.oauth2_jwt/);
  assert.match(migration, /connection_setup_v2/);
  assert.match(migration, /children,2,children,0,props,fields/);
  assert.doesNotMatch(migration, /"path"\s*:\s*"tenant_id"|"key"\s*:\s*"tenant_id"/i);
});
