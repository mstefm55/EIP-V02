import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  here,
  "../../../db/migrations/v2_0061_connection_operator_ui_readiness.sql"
);
const source = fs.readFileSync(migrationPath, "utf8");

const retiredDuplicateKeys = [
  "auth_header_name",
  "auth_query_param_name",
  "auth_public_key_ref",
  "auth_username",
  "auth_client_id",
  "auth_client_method",
  "auth_token_url",
  "auth_scope",
];

const canonicalSecurityKeys = [
  "outbound_api_key_header",
  "outbound_api_key_query",
  "outbound_username",
  "oauth_client_id",
  "oauth_client_auth_method",
  "oauth_token_url",
  "oauth_scope",
];

test("Connections Security UI retires duplicate and non-executable legacy inputs", () => {
  for (const key of retiredDuplicateKeys) {
    assert.match(source, new RegExp(`'${key}'`), `${key} is not included in the forward cleanup`);
    assert.match(
      source,
      new RegExp(`jsonb_path_exists\\(surface_tree, '\\$\\.\\*\\* \\? \\(@\\.key == "${key}"\\)'\\)`),
      `${key} absence is not validated`
    );
  }

  for (const key of canonicalSecurityKeys) {
    assert.match(
      source,
      new RegExp(`@\\.key == "${key}"`),
      `${key} is not retained as the canonical Security input`
    );
  }
});

test("Test & Health exposes readiness, request preview, and authenticated execution through generic actions", () => {
  assert.match(source, /"type":"ContractActionPanel"/);
  assert.match(source, /"id":"connection_readiness"/);
  assert.match(source, /"id":"preview_authenticated_request"/);
  assert.match(source, /"id":"execute_authenticated_request"/);
  assert.match(source, /\/connections\/tenants\/:tenant_code\/:code\/readiness/);
  assert.match(source, /\/connections\/tenants\/:tenant_code\/:code\/request-plan/);
  assert.match(source, /\/connections\/tenants\/:tenant_code\/:code\/execute/);
  assert.match(source, /"tenant_code":"\$selections\.connection_tenant\.code"/);
  assert.doesNotMatch(source, /"path_params"\s*:\s*\{[^}]*"tenant_id"/);
});

test("operator test actions stay on dedicated permissions and do not create a second provider UI", () => {
  assert.match(source, /"permissions_any":\["OWNER_ADMIN_CONNECTION_TEST"\]/);
  assert.match(source, /"permissions_any":\["OWNER_ADMIN_CONNECTION_READ"\]/);
  assert.doesNotMatch(source, /CREATE\s+TABLE/i);
  assert.doesNotMatch(source, /Stripe[A-Za-z]*Panel|PayPal[A-Za-z]*Panel/);
  assert.match(source, /Sending requires the connection to be enabled/);
});

test("network reachability and authenticated execution are clearly separated for operators", () => {
  assert.match(source, /Endpoint health check/);
  assert.match(source, /Check network reachability to the configured outbound endpoint/);
  assert.match(source, /Authenticated request test/);
  assert.match(source, /Preview request/);
  assert.match(source, /Send test request/);
});
