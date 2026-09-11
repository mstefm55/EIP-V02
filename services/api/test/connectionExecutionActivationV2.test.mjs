import assert from "node:assert/strict";
import test from "node:test";

import {
  requiredConnectionCredentialKinds,
  validateConnectionActivation,
} from "../src/services/connections/connectionActivation.js";

function baseInbound(providerCode) {
  return {
    identity: {
      direction: "inbound",
      environment: "production",
      is_enabled: true,
    },
    inbound: {
      webhook_enabled: true,
      inbound_path_suffix: "provider-events",
      http_method: "POST",
      expected_content_type: "application/json",
      rate_limit: { max: 100, window_sec: 60 },
    },
    verification: {
      mode: "provider_signature",
      allow_unverified: false,
    },
    idempotency: {
      event_id_location: "body",
      event_id_key: "id",
      idempotency_scope: "connection",
    },
    routing: {
      mapping_mode: "passthrough",
      provider_code: providerCode,
    },
    attrs: {
      provider_signature: {
        provider_code: providerCode,
        max_skew_sec: 300,
      },
    },
  };
}

function baseOutbound(authMode) {
  return {
    identity: {
      direction: "outbound",
      environment: "sandbox",
      is_enabled: true,
    },
    outbound: {
      base_url: "https://api.example.com",
      auth_mode: authMode,
      auth: {},
    },
    attrs: {
      outbound_request: {
        body_encoding: "json",
        response_encoding: "auto",
      },
    },
  };
}

test("Stripe provider-signature activation requires the governed signing secret", () => {
  const profile = baseInbound("stripe");
  assert.deepEqual(requiredConnectionCredentialKinds(profile), ["webhook_signing_secret"]);

  const missing = validateConnectionActivation(profile, {});
  assert.ok(missing.some((entry) => entry.code === "ACTIVATION_CREDENTIAL_REQUIRED"));

  const configured = validateConnectionActivation(profile, {
    webhook_signing_secret: { configured: true, status: "active" },
  });
  assert.equal(configured.some((entry) => entry.path?.startsWith("attrs.provider_signature")), false);
  assert.equal(configured.some((entry) => entry.code === "ACTIVATION_CREDENTIAL_REQUIRED"), false);
});

test("PayPal provider-signature activation requires webhook ID but no stored provider secret", () => {
  const profile = baseInbound("paypal");
  assert.deepEqual(requiredConnectionCredentialKinds(profile), []);
  const missing = validateConnectionActivation(profile, {});
  assert.ok(missing.some((entry) => entry.code === "ACTIVATION_PAYPAL_WEBHOOK_ID_REQUIRED"));

  profile.attrs.provider_signature.webhook_id = "WH-123";
  const configured = validateConnectionActivation(profile, {});
  assert.equal(configured.some((entry) => entry.code === "ACTIVATION_PAYPAL_WEBHOOK_ID_REQUIRED"), false);
  assert.equal(configured.some((entry) => entry.code === "ACTIVATION_PROVIDER_SIGNATURE_UNSUPPORTED"), false);
});

test("unknown provider signature adapter fails activation", () => {
  const issues = validateConnectionActivation(baseInbound("made-up-provider"), {});
  assert.ok(issues.some((entry) => entry.code === "ACTIVATION_PROVIDER_SIGNATURE_UNSUPPORTED"));
});

test("OAuth2 client credentials require client ID token URL and encrypted client secret", () => {
  const profile = baseOutbound("oauth2_client_credentials");
  let issues = validateConnectionActivation(profile, {});
  assert.ok(issues.some((entry) => entry.code === "ACTIVATION_OAUTH_CLIENT_ID_REQUIRED"));
  assert.ok(issues.some((entry) => entry.code === "ACTIVATION_OAUTH_TOKEN_URL_REQUIRED"));
  assert.ok(issues.some((entry) => entry.code === "ACTIVATION_CREDENTIAL_REQUIRED"));

  profile.outbound.auth.client_id = "client-id";
  profile.outbound.auth.token_url = "https://api.example.com/oauth2/token";
  profile.attrs.oauth_client_credentials = {
    client_auth_method: "basic",
    token_body_encoding: "form",
  };
  issues = validateConnectionActivation(profile, {
    oauth_client_secret: { configured: true, status: "active" },
  });
  assert.equal(issues.length, 0);
});

test("activation rejects request encodings the runtime cannot consume", () => {
  const profile = baseOutbound("none");
  profile.attrs.outbound_request.body_encoding = "xml-magic";
  profile.attrs.outbound_request.response_encoding = "protobuf-magic";
  const issues = validateConnectionActivation(profile, {});
  assert.ok(issues.some((entry) => entry.code === "ACTIVATION_OUTBOUND_BODY_ENCODING_UNSUPPORTED"));
  assert.ok(issues.some((entry) => entry.code === "ACTIVATION_OUTBOUND_RESPONSE_ENCODING_UNSUPPORTED"));
});
