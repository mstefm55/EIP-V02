import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizePublicJson,
  toConnectionDetailDto,
} from "../src/services/connections/connectionDto.js";

test("public JSON sanitizer recursively removes credential-shaped keys", () => {
  const value = sanitizePublicJson({
    safe: "yes",
    client_secret: "no",
    accessToken: "no",
    apiKey: "no",
    nested: {
      password_ref: "no",
      private_key: "no",
      label: "yes",
    },
  });

  assert.deepEqual(value, {
    safe: "yes",
    nested: { label: "yes" },
  });
});

test("detail DTO never projects stored secret values even from an unsafe legacy row", () => {
  const dto = toConnectionDetailDto({
    id: "id-1",
    profile_version: 1,
    identity: {
      connection_name: "Unsafe legacy",
      connection_code: "unsafe_conn",
      connection_kind: "custom",
      direction: "outbound",
      environment: "sandbox",
      is_enabled: true,
    },
    verification: {
      mode: "api_key",
      api_key: { header_name: "X-API-Key", secret: "must-not-leak" },
      hmac_signature: { secret: "must-not-leak" },
      oauth2_jwt: { test_token: "must-not-leak" },
    },
    outbound: {
      base_url: "https://example.com",
      auth_mode: "api_key_header",
      auth: {
        header_name: "X-API-Key",
        secret: "must-not-leak",
        password: "must-not-leak",
        client_secret: "must-not-leak",
        token: "must-not-leak",
        client_id: "safe-client-id",
      },
      default_headers: {
        Accept: "application/json",
        Authorization: "Bearer must-not-leak",
      },
    },
    attrs: {
      nested: { api_key: "must-not-leak", note: "safe" },
    },
  }, {
    api_key: {
      configured: true,
      version: 3,
      ciphertext_b64: "must-not-leak",
      key_id: "must-not-leak",
    },
  });

  const encoded = JSON.stringify(dto);
  assert.equal(encoded.includes("must-not-leak"), false);
  assert.equal(dto.outbound.auth.client_id, "safe-client-id");
  assert.equal(dto.attrs.nested.note, "safe");
  assert.equal(dto.credential_status.api_key.configured, true);
  assert.equal(dto.credential_status.api_key.version, 3);
  assert.equal("ciphertext_b64" in dto.credential_status.api_key, false);
  assert.equal("key_id" in dto.credential_status.api_key, false);
});
