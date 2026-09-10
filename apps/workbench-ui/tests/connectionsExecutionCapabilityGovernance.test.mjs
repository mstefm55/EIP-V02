import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  here,
  "../../../db/migrations/v2_0059_connection_generic_execution_capability.sql"
);
const source = fs.readFileSync(migrationPath, "utf8");

const advancedFields = [
  "request_body_encoding",
  "response_encoding",
  "request_content_type",
  "request_accept",
  "outbound_api_key_header",
  "outbound_api_key_query",
  "outbound_username",
  "oauth_client_id",
  "oauth_token_url",
  "oauth_scope",
  "oauth_client_auth_method",
  "oauth_token_body_encoding",
  "oauth_token_params",
  "oauth_token_header",
  "oauth_token_prefix",
  "provider_verifier",
  "provider_signature_header",
  "provider_webhook_id",
  "provider_signature_tolerance",
  "outbound_idempotency_header",
  "max_request_body_bytes",
  "max_response_body_bytes",
];

test("execution/provider configuration is added through metadata and kept under Advanced disclosure", () => {
  for (const key of advancedFields) {
    const pattern = new RegExp(`\\"key\\":\\"${key}\\"[^}]*\\"advanced\\":true`);
    assert.match(source, pattern, `${key} is not governed as an Advanced field`);
  }
  assert.match(source, /CONNECTION_PROVIDER_VERIFIER/);
  assert.match(source, /CONNECTION_BODY_ENCODING/);
  assert.match(source, /CONNECTION_RESPONSE_ENCODING/);
  assert.match(source, /CONNECTION_OAUTH_CLIENT_AUTH_METHOD/);
  assert.match(source, /CONNECTION_OAUTH_TOKEN_BODY_ENCODING/);
});

test("provider-specific behavior is selected by metadata rather than hardcoded React UI", () => {
  assert.match(source, /'CONNECTION_PROVIDER_VERIFIER', 'stripe', 'Stripe'/);
  assert.match(source, /'CONNECTION_PROVIDER_VERIFIER', 'paypal', 'PayPal'/);
  assert.match(source, /"options_path":"taxonomy\.CONNECTION_PROVIDER_VERIFIER"/);
  assert.doesNotMatch(source, /type.*Stripe/i);
  assert.doesNotMatch(source, /type.*PayPal/i);
});

test("legacy raw outbound auth JSON box is removed instead of duplicating explicit inputs", () => {
  assert.match(source, /WHERE item\.value ->> 'key' <> 'outbound_auth_config'/);
  assert.match(source, /jsonb_path_exists\(surface_tree, '\$\.\*\* \? \(@\.key == "outbound_auth_config"\)'\)/);
});

test("upgrade does not introduce developer commentary into production field metadata", () => {
  for (const phrase of [
    "server-authorized",
    "tenant-scoped",
    "V1 naming protocol",
    "implementation",
    "browser override",
    "write-only credentials",
  ]) {
    const quotedUiPhrase = new RegExp(`\\"(?:label|help|subtitle|title)\\":\\"[^\\"]*${phrase}`, "i");
    assert.doesNotMatch(source, quotedUiPhrase);
  }
});
