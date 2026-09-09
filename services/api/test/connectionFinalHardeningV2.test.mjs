import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateConnectionActivation } from "../src/services/connections/connectionActivation.js";
import {
  MAX_CONNECTION_BODY_BYTES,
  SUPPORTED_INBOUND_HTTP_METHODS,
  isSupportedInboundHttpMethod,
  isValidInboundSuffix,
} from "../src/services/connections/connectionInboundPolicy.js";
import { buildInboundReadiness } from "../src/services/connections/connectionReadiness.js";
import { toConnectionDetailDto } from "../src/services/connections/connectionDto.js";
import { PUBLIC_METHODS } from "../src/routes/public_connections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const migration = fs.readFileSync(
  path.resolve(repoRoot, "db/migrations/v2_0052_connection_management_final_hardening.sql"),
  "utf8"
);

function inboundProfile(overrides = {}) {
  return {
    identity: {
      connection_name: "Orders",
      connection_code: "orders",
      connection_kind: "custom",
      direction: "inbound",
      environment: "sandbox",
      is_enabled: true,
    },
    inbound: {
      inbound_path_suffix: "orders",
      webhook_enabled: true,
      http_method: "POST",
      expected_content_type: "application/json",
      rate_limit: { max: null, window_sec: null },
    },
    verification: {
      mode: "none",
      allow_unverified: true,
      api_key: { header_name: "" },
      hmac_signature: {},
    },
    idempotency: {
      event_id_location: "header",
      event_id_key: "x-event-id",
      idempotency_scope: "connection",
    },
    outbound: { auth_mode: "" },
    routing: {
      mapping_mode: "passthrough",
      schema_version: "v1",
      envelope_profile: "canonical_v1",
    },
    audit: { log_level: "info" },
    ...overrides,
  };
}

test("one canonical inbound transport policy drives public methods and bounded body size", () => {
  assert.deepEqual([...SUPPORTED_INBOUND_HTTP_METHODS], ["POST", "PUT", "PATCH"]);
  assert.deepEqual([...PUBLIC_METHODS], ["POST", "PUT", "PATCH"]);
  assert.equal(isSupportedInboundHttpMethod("post"), true);
  assert.equal(isSupportedInboundHttpMethod("GET"), false);
  assert.equal(isValidInboundSuffix("orders_2026"), true);
  assert.equal(isValidInboundSuffix("bad/path"), false);
  assert.equal(MAX_CONNECTION_BODY_BYTES, 5_242_880);
});

test("activation blocks routes the live public gateway cannot actually serve", () => {
  const unsupportedMethod = inboundProfile();
  unsupportedMethod.inbound.http_method = "GET";
  const methodErrors = validateConnectionActivation(unsupportedMethod, {});
  assert.ok(methodErrors.some((entry) => entry.code === "ACTIVATION_INBOUND_HTTP_METHOD_UNSUPPORTED"));

  const invalidSuffix = inboundProfile();
  invalidSuffix.inbound.inbound_path_suffix = "bad/path";
  const suffixErrors = validateConnectionActivation(invalidSuffix, {});
  assert.ok(suffixErrors.some((entry) => entry.code === "ACTIVATION_INBOUND_PATH_INVALID"));
});

test("readiness fails closed for unsupported methods and invalid rate-limit pairs", () => {
  const unsupportedMethod = inboundProfile();
  unsupportedMethod.inbound.http_method = "HEAD";
  const unsupported = buildInboundReadiness(unsupportedMethod, {});
  assert.equal(unsupported.runtime_available, false);
  assert.equal(unsupported.activation_ready, false);
  assert.equal(unsupported.checks.find((entry) => entry.code === "HTTP_METHOD")?.ok, false);

  const invalidRate = inboundProfile();
  invalidRate.inbound.rate_limit = { max: 100, window_sec: null };
  const rateResult = buildInboundReadiness(invalidRate, {});
  assert.equal(rateResult.runtime_available, false);
  assert.equal(rateResult.activation_ready, false);
  assert.equal(rateResult.checks.find((entry) => entry.code === "RATE_LIMIT")?.ok, false);
});

test("detail DTO removes retired inbound JWT metadata while preserving outbound OAuth client metadata", () => {
  const profile = inboundProfile({
    verification: {
      mode: "none",
      allow_unverified: true,
      oauth2_jwt: {
        issuer: "legacy-issuer",
        audience: "legacy-audience",
      },
    },
    outbound: {
      auth_mode: "oauth2_client_credentials",
      auth: {
        client_id: "provider-client",
        client_auth_method: "client_secret_post",
        token_url: "https://provider.example/oauth/token",
        scope: "orders.read",
      },
    },
  });

  const dto = toConnectionDetailDto(profile, {});
  assert.equal("oauth2_jwt" in dto.verification, false);
  assert.equal(dto.outbound.auth.client_id, "provider-client");
  assert.equal(dto.outbound.auth.token_url, "https://provider.example/oauth/token");
});

test("final forward migration restores full Reliability UX and hardens tenant routing persistence", () => {
  assert.match(migration, /tenant_settings_connection_inbound_path_uk/);
  assert.match(migration, /connection_profile_strip_deprecated_inbound_auth/);
  assert.match(migration, /set_config\('app\.current_tenant_id'/);
  assert.match(migration, /setting_value\s*=\s*setting_value\s*#-\s*'\{verification,oauth2_jwt\}'/);

  for (const fieldPath of [
    "idempotency.event_id_location",
    "idempotency.event_id_key",
    "idempotency.idempotency_scope",
    "inbound.rate_limit.max",
    "inbound.rate_limit.window_sec",
    "outbound.timeout_ms",
    "outbound.retry_policy.max_retries",
    "outbound.retry_policy.backoff_ms",
  ]) {
    assert.ok(migration.includes(fieldPath), `missing final Reliability path ${fieldPath}`);
  }

  assert.match(migration, /dv\.code = 'oauth2_jwt'[\s\S]*dv\.is_active = true/);
  assert.match(migration, /dv\.code = 'oauth2_client_credentials'[\s\S]*dv\.is_active = true/);
  assert.doesNotMatch(migration, /"path"\s*:\s*"tenant_id"/i);
  assert.doesNotMatch(migration, /"key"\s*:\s*"tenant_id"/i);
});
