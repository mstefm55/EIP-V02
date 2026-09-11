import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SAFE_CONNECTION_PROBE_METHODS,
  validateConnectionActivation,
} from "../src/services/connections/connectionActivation.js";
import {
  buildInboundReadiness,
  buildOutboundReadiness,
} from "../src/services/connections/connectionReadiness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.resolve(here, "../../../db/migrations/v2_0062_connection_zero_pending_closure.sql"),
  "utf8"
);

function canonicalGovernance() {
  return {
    routing: {
      channel: "custom",
      schema_version: "v1",
      envelope_profile: "json",
      mapping_mode: "passthrough",
      mapping: {},
    },
    audit: { log_level: "info" },
  };
}

function inboundProfile() {
  return {
    identity: { direction: "inbound", environment: "production", is_enabled: true },
    inbound: {
      webhook_enabled: true,
      inbound_path_suffix: "events",
      http_method: "POST",
      expected_content_type: "application/json",
      rate_limit: { max: 50, window_sec: 60 },
    },
    verification: {
      mode: "api_key",
      allow_unverified: false,
      api_key: { header_name: "x-api-key" },
    },
    idempotency: {
      event_id_location: "header",
      event_id_key: "x-event-id",
      idempotency_scope: "connection",
    },
    ...canonicalGovernance(),
  };
}

function outboundProfile() {
  return {
    identity: { direction: "outbound", environment: "production", is_enabled: true },
    outbound: {
      base_url: "https://api.example.com",
      auth_mode: "none",
      auth: {},
      test_request_method: "HEAD",
    },
    attrs: { outbound_request: { response_encoding: "auto" } },
    ...canonicalGovernance(),
  };
}

test("readiness exposes one canonical ready boolean for acceptance and UI consumers", () => {
  const inbound = buildInboundReadiness(inboundProfile(), {
    api_key: { configured: true, status: "active" },
  });
  assert.equal(inbound.ready, true);
  assert.equal(inbound.ready, inbound.runtime_available);

  const outbound = buildOutboundReadiness(outboundProfile(), {});
  assert.equal(outbound.ready, true);
  assert.equal(outbound.ready, outbound.runtime_available);
});

test("activation readiness cannot be green when seven-step governance metadata is incomplete", () => {
  const profile = inboundProfile();
  profile.routing.schema_version = "";
  profile.routing.envelope_profile = "";
  profile.audit.log_level = "";

  const issues = validateConnectionActivation(profile, {
    api_key: { configured: true, status: "active" },
  });
  assert.ok(issues.some((entry) => entry.code === "ACTIVATION_SCHEMA_VERSION_REQUIRED"));
  assert.ok(issues.some((entry) => entry.code === "ACTIVATION_ENVELOPE_PROFILE_REQUIRED"));
  assert.ok(issues.some((entry) => entry.code === "ACTIVATION_LOG_LEVEL_REQUIRED"));
});

test("endpoint health probes are non-mutating by contract", () => {
  assert.deepEqual([...SAFE_CONNECTION_PROBE_METHODS], ["GET", "HEAD"]);

  const unsafe = outboundProfile();
  unsafe.outbound.test_request_method = "PATCH";
  const activationIssues = validateConnectionActivation(unsafe, {});
  assert.ok(activationIssues.some((entry) => entry.code === "ACTIVATION_PROBE_METHOD_UNSAFE"));

  const readiness = buildOutboundReadiness(unsafe, {});
  assert.equal(readiness.ready, false);
  assert.equal(readiness.checks.find((entry) => entry.code === "TEST_METHOD")?.ok, false);
});

test("zero-pending migration removes overwrite/dead fields and constrains health-check UI", () => {
  assert.match(migration, /'provider_extensions'/);
  assert.match(migration, /'raw_body_required'/);
  assert.match(migration, /'auth_public_key_ref'/);
  assert.match(migration, /'test_request_method'/);
  assert.match(migration, /'default_value', 'HEAD'/);
  assert.match(migration, /jsonb_build_object\('value', 'HEAD'/);
  assert.match(migration, /jsonb_build_object\('value', 'GET'/);
  assert.match(migration, /connection_profile_strip_deprecated_inbound_auth/);
  assert.match(migration, /#- '\{verification,oauth2_jwt\}'/);
  assert.match(migration, /#- '\{inbound,raw_body_required\}'/);
  assert.match(migration, /#- '\{outbound,auth,public_key_ref\}'/);
  assert.match(migration, /surface_tree::text LIKE '%\"path\":\"attrs\"%'/);
  assert.match(migration, /surface_tree::text LIKE '%\"tenant_id\"%'/);
});
