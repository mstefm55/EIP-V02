import assert from "node:assert/strict";
import test from "node:test";

import {
  ConnectionInputPolicyError,
  assertConnectionProfileInputSafe,
} from "../src/services/connections/connectionInputPolicy.js";
import {
  sanitizeConnectionAttrs,
  toConnectionDetailDto,
} from "../src/services/connections/connectionDto.js";
import { effectiveConnectionRuntimeProfile } from "../src/services/connections/connectionExecutionProfile.js";

const profile = {
  identity: {
    connection_code: "conn-4",
    connection_name: "Provider",
    direction: "both",
    environment: "sandbox",
    is_enabled: false,
  },
  outbound: {
    base_url: "https://api.example.com",
    auth_mode: "oauth2_client_credentials",
    auth: {
      client_id: "public-client-id",
      token_url: "https://api.example.com/oauth/token",
      scope: "payments",
    },
  },
  attrs: {
    outbound_request: {
      body_encoding: "json",
      response_encoding: "auto",
      content_type: "application/json",
      accept: "application/json",
      idempotency_header_name: "PayPal-Request-Id",
      max_body_bytes: 262144,
      max_response_bytes: 524288,
    },
    oauth_client_credentials: {
      client_auth_method: "basic",
      token_body_encoding: "form",
      token_params: {
        audience: "merchant-api",
        grant_type_hint: "client_credentials",
        client_secret: "must-not-leak",
      },
      token_headers: {
        "X-Public-Context": "merchant",
        Authorization: "must-not-leak",
        "X-Client-Secret": "must-not-leak",
      },
      token_header_name: "Authorization",
      token_prefix: "Bearer",
    },
    provider_signature: {
      provider_code: "stripe",
      header_name: "Stripe-Signature",
      webhook_id: "WH-public-id",
      max_skew_sec: 300,
      secret_kind: "webhook_signing_secret",
    },
  },
};

test("effective runtime profile maps governed attrs into consuming runtime locations", () => {
  const effective = effectiveConnectionRuntimeProfile(profile);
  assert.equal(effective.outbound.request.body_encoding, "json");
  assert.equal(effective.outbound.request.idempotency_header_name, "PayPal-Request-Id");
  assert.equal(effective.outbound.auth.client_auth_method, "basic");
  assert.equal(effective.outbound.auth.token_body_encoding, "form");
  assert.equal(effective.outbound.auth.token_params.audience, "merchant-api");
  assert.equal(effective.verification.provider_signature.provider_code, "stripe");
  assert.equal(effective.verification.provider_signature.header_name, "Stripe-Signature");
});

test("detail DTO round-trips safe execution configuration but never projects secret material", () => {
  const dto = toConnectionDetailDto(profile, {
    oauth_client_secret: {
      configured: true,
      status: "active",
      version: 2,
      fingerprint: "safe-fingerprint",
    },
  });

  assert.equal(dto.attrs.outbound_request.body_encoding, "json");
  assert.equal(dto.attrs.oauth_client_credentials.client_auth_method, "basic");
  assert.equal(dto.attrs.oauth_client_credentials.token_body_encoding, "form");
  assert.equal(dto.attrs.oauth_client_credentials.token_params.audience, "merchant-api");
  assert.equal(dto.attrs.oauth_client_credentials.token_params.client_secret, undefined);
  assert.equal(dto.attrs.oauth_client_credentials.token_headers["X-Public-Context"], "merchant");
  assert.equal(dto.attrs.oauth_client_credentials.token_headers.Authorization, undefined);
  assert.equal(dto.attrs.oauth_client_credentials.token_headers["X-Client-Secret"], undefined);
  assert.equal(dto.attrs.oauth_client_credentials.token_header_name, "Authorization");
  assert.equal(dto.attrs.oauth_client_credentials.token_prefix, "Bearer");
  assert.equal(dto.attrs.provider_signature.provider_code, "stripe");
  assert.equal(dto.attrs.provider_signature.secret_kind, "webhook_signing_secret");

  const serialized = JSON.stringify(dto);
  assert.equal(serialized.includes("must-not-leak"), false);
  assert.equal(serialized.includes("safe-fingerprint"), true);
});

test("profile input rejects embedded credentials and sensitive persisted auth headers", () => {
  assert.throws(
    () => assertConnectionProfileInputSafe({
      attrs: {
        oauth_client_credentials: {
          token_headers: { Authorization: "Bearer embedded" },
        },
      },
    }),
    (error) => error instanceof ConnectionInputPolicyError
      && error.code === "CONNECTION_SENSITIVE_HEADER_FORBIDDEN"
  );

  assert.throws(
    () => assertConnectionProfileInputSafe({
      attrs: {
        oauth_client_credentials: {
          client_secret: "embedded-secret",
        },
      },
    }),
    (error) => error instanceof ConnectionInputPolicyError
      && error.code === "CONNECTION_SECRET_IN_PROFILE_FORBIDDEN"
  );

  assert.doesNotThrow(() => assertConnectionProfileInputSafe({
    attrs: {
      oauth_client_credentials: {
        client_auth_method: "basic",
        token_body_encoding: "form",
        token_params: { audience: "merchant-api" },
        token_headers: { "X-Public-Context": "merchant" },
      },
      provider_signature: {
        provider_code: "paypal",
        webhook_id: "WH-123",
        max_skew_sec: 300,
      },
    },
  }));
});

test("explicit Connections attr sanitizer permits non-secret token configuration names", () => {
  const attrs = sanitizeConnectionAttrs(profile.attrs);
  assert.equal(attrs.oauth_client_credentials.token_header_name, "Authorization");
  assert.equal(attrs.oauth_client_credentials.token_prefix, "Bearer");
  assert.equal(attrs.oauth_client_credentials.token_params.audience, "merchant-api");
  assert.equal(attrs.oauth_client_credentials.token_params.client_secret, undefined);
});
