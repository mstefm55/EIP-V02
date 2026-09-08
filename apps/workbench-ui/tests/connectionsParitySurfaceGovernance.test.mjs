import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function read(relativePath) {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), "utf8");
}

const migration = read("db/migrations/v2_0046_connection_management_functional_parity.sql");
const actionPanel = read("apps/workbench-ui/src/components/primitives/ContractActionPanel.jsx");

test("connection parity migration preserves seven-step UX and tenant-safe ownership", () => {
  assert.match(migration, /connection_setup_v2/);
  assert.match(migration, /authenticated organisation/i);
  assert.match(migration, /tenant-scoped/i);
  assert.match(migration, /no tenant selector or tenant override is introduced/i);
  assert.doesNotMatch(migration, /"path"\s*:\s*"tenant_id"/i);
  assert.doesNotMatch(migration, /"key"\s*:\s*"tenant_id"/i);
});

test("connection parity migration restores delete and one-time API key generation", () => {
  assert.match(migration, /"method":"DELETE","endpoint":"\/api\/eip\/owner-admin\/connections\/:code"/);
  assert.match(migration, /\/api\/eip\/owner-admin\/connections\/:code\/api-key\/generate/);
  assert.match(migration, /"path":"raw_key"/);
  assert.match(migration, /will not be shown again/i);
  assert.match(migration, /clear_selection_target/);
  assert.match(migration, /OWNER_ADMIN_CONNECTION_SECRET_MANAGE/);
  assert.match(migration, /OWNER_ADMIN_CONNECTION_WRITE/);
});

test("advanced connection metadata remains governed and secrets stay on credential lifecycle", () => {
  for (const path of [
    "verification.hmac_signature.header_name",
    "verification.hmac_signature.algorithm",
    "verification.hmac_signature.encoding",
    "verification.hmac_signature.payload_mode",
    "verification.hmac_signature.timestamp_header",
    "verification.oauth2_jwt.issuer",
    "verification.oauth2_jwt.audience",
    "verification.oauth2_jwt.jwks_url",
    "outbound.auth.header_name",
    "outbound.auth.query_param_name",
    "outbound.auth.username",
    "outbound.auth.client_id",
    "outbound.auth.token_url",
    "attrs"
  ]) {
    assert.ok(migration.includes(`\"path\":\"${path}\"`), `missing advanced path ${path}`);
  }

  assert.doesNotMatch(migration, /"path":"[^"]*(?:password|client_secret|bearer_token|api_key_value|private_key)[^"]*"/i);
  assert.match(migration, /Credentials must use the Security credential lifecycle/);
});

test("generic action panel keeps one-time result transient and copyable", () => {
  assert.match(actionPanel, /const \[actionResult, setActionResult\] = useState\(null\)/);
  assert.match(actionPanel, /navigator\.clipboard\.writeText/);
  assert.match(actionPanel, /clear_selection_target/);
  assert.match(actionPanel, /ctx\?\.selection\?\.clearTarget/);
  assert.doesNotMatch(actionPanel, /localStorage|sessionStorage|indexedDB/i);
});
