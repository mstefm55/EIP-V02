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

test("OAuth2 JWT readiness reports the verifier runtime as pending", () => {
  const profile = baseProfile();
  profile.verification.mode = "oauth2_jwt";
  profile.verification.oauth2_jwt = {
    issuer: "https://issuer.example",
    audience: "eip",
    jwks_url: "https://issuer.example/.well-known/jwks.json",
  };

  const result = buildInboundReadiness(profile, {});
  assert.equal(result.configured, true);
  assert.equal(result.runtime_available, false);
  assert.equal(result.runtime_status, "OAUTH2_JWT_RUNTIME_PENDING");
});
