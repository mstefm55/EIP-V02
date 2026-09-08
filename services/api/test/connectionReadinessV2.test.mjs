import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInboundReadiness,
  requiredInboundSecretKind,
} from "../src/services/connections/connectionReadiness.js";

function baseProfile() {
  return {
    identity: {
      direction: "inbound",
      environment: "production",
    },
    inbound: {
      inbound_path_suffix: "orders",
      webhook_enabled: true,
      http_method: "POST",
      expected_content_type: "application/json",
    },
    verification: {
      mode: "api_key",
      allow_unverified: false,
      api_key: {
        header_name: "x-api-key",
      },
    },
    idempotency: {
      event_id_location: "header",
      event_id_key: "x-event-id",
      idempotency_scope: "connection",
    },
    routing: {
      mapping_mode: "passthrough",
      mapping: {},
    },
  };
}

test("inbound readiness requires the governed credential and reports live API-key runtime", () => {
  const profile = baseProfile();
  assert.equal(requiredInboundSecretKind(profile), "api_key");

  const missing = buildInboundReadiness(profile, {});
  assert.equal(missing.configured, false);
  assert.equal(missing.runtime_available, false);
  assert.equal(missing.runtime_status, "CONFIGURATION_INCOMPLETE");
  assert.equal(missing.checks.find((check) => check.code === "CREDENTIAL")?.ok, false);

  const ready = buildInboundReadiness(profile, {
    api_key: { configured: true, status: "active" },
  });
  assert.equal(ready.configured, true);
  assert.equal(ready.activation_ready, true);
  assert.equal(ready.runtime_available, true);
  assert.equal(ready.runtime_status, "AVAILABLE");
  assert.equal(ready.mapping_mode, "passthrough");
  assert.equal(ready.business_dispatch_available, false);
});

test("mapped inbound readiness requires a bounded Service Object projection", () => {
  const profile = baseProfile();
  profile.routing.mapping_mode = "mapped";
  profile.routing.mapping = {};

  const invalid = buildInboundReadiness(profile, {
    api_key: { configured: true, status: "active" },
  });
  assert.equal(invalid.configured, false);
  assert.equal(invalid.runtime_available, false);
  assert.equal(invalid.business_dispatch_available, false);
  assert.equal(invalid.checks.find((check) => check.code === "MAPPING_CONFIGURATION")?.ok, false);
  assert.ok(invalid.activation_blockers.some((entry) => entry.path === "routing.mapping.service_object"));

  profile.routing.mapping = {
    service_object: {
      object_type: "ORDER",
      code: "$body.order_id",
      attrs: { external_id: "$body.order_id" },
    },
  };
  const ready = buildInboundReadiness(profile, {
    api_key: { configured: true, status: "active" },
  });
  assert.equal(ready.configured, true);
  assert.equal(ready.runtime_available, true);
  assert.equal(ready.business_dispatch_available, true);
  assert.equal(ready.mapping_errors.length, 0);
});

test("inbound readiness fails closed when idempotency metadata is incomplete", () => {
  const profile = baseProfile();
  profile.idempotency.event_id_key = "";

  const result = buildInboundReadiness(profile, {
    api_key: { configured: true, status: "active" },
  });
  assert.equal(result.configured, false);
  assert.equal(result.runtime_available, false);
  assert.equal(result.checks.find((check) => check.code === "IDEMPOTENCY_KEY")?.ok, false);
  assert.ok(result.activation_blockers.some((entry) => entry.code === "ACTIVATION_IDEMPOTENCY_KEY_REQUIRED"));
});

test("production inbound readiness fails closed for unverified policy", () => {
  const profile = baseProfile();
  profile.verification.mode = "none";
  profile.verification.allow_unverified = true;

  const result = buildInboundReadiness(profile, {});
  assert.equal(result.configured, false);
  assert.equal(result.runtime_available, false);
  assert.equal(result.checks.find((check) => check.code === "VERIFICATION")?.ok, false);
  assert.equal(result.checks.find((check) => check.code === "UNVERIFIED_POLICY")?.ok, false);
});

test("sandbox none mode is live only when unverified traffic is explicitly enabled", () => {
  const profile = baseProfile();
  profile.identity.environment = "sandbox";
  profile.verification.mode = "none";
  profile.verification.allow_unverified = false;

  const blocked = buildInboundReadiness(profile, {});
  assert.equal(blocked.configured, false);
  assert.equal(blocked.runtime_available, false);

  profile.verification.allow_unverified = true;
  const ready = buildInboundReadiness(profile, {});
  assert.equal(ready.configured, true);
  assert.equal(ready.runtime_available, true);
  assert.equal(ready.runtime_status, "AVAILABLE");
});

test("OAuth/JWT is not an inbound EIP authentication mode", () => {
  const profile = baseProfile();
  profile.verification.mode = "oauth2_jwt";

  const result = buildInboundReadiness(profile, {});
  assert.equal(result.configured, false);
  assert.equal(result.activation_ready, false);
  assert.equal(result.runtime_available, false);
  assert.equal(result.runtime_status, "VERIFICATION_MODE_UNSUPPORTED");
  assert.equal(result.checks.find((check) => check.code === "VERIFICATION")?.ok, false);
  assert.ok(
    result.activation_blockers.some((entry) => entry.code === "ACTIVATION_VERIFICATION_UNSUPPORTED")
  );
});
