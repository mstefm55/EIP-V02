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
      http_method: "POST",
      expected_content_type: "application/json",
    },
    verification: {
      mode: "api_key",
      allow_unverified: false,
    },
  };
}

test("inbound readiness requires the governed credential for symmetric verification", () => {
  const profile = baseProfile();
  assert.equal(requiredInboundSecretKind(profile), "api_key");

  const missing = buildInboundReadiness(profile, {});
  assert.equal(missing.configured, false);
  assert.equal(missing.runtime_available, false);
  assert.equal(missing.runtime_status, "PUBLIC_INBOUND_RUNTIME_NOT_RESTORED");
  assert.equal(missing.checks.find((check) => check.code === "CREDENTIAL")?.ok, false);

  const ready = buildInboundReadiness(profile, {
    api_key: { configured: true, status: "active" },
  });
  assert.equal(ready.configured, true);
  assert.equal(ready.runtime_available, false);
});

test("production inbound readiness fails closed for unverified policy", () => {
  const profile = baseProfile();
  profile.verification.mode = "none";
  profile.verification.allow_unverified = true;

  const result = buildInboundReadiness(profile, {});
  assert.equal(result.configured, false);
  assert.equal(result.checks.find((check) => check.code === "VERIFICATION")?.ok, false);
  assert.equal(result.checks.find((check) => check.code === "UNVERIFIED_POLICY")?.ok, false);
});
