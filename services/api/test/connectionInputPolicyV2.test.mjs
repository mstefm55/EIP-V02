import assert from "node:assert/strict";
import test from "node:test";
import {
  assertConnectionProfileInputSafe,
} from "../src/services/connections/connectionInputPolicy.js";

test("allows non-secret authentication metadata", () => {
  assert.equal(assertConnectionProfileInputSafe({
    verification: {
      api_key: { header_name: "X-API-Key" },
      oauth2_jwt: {
        token_prefix: "Bearer",
        jwks_url: "https://example.com/.well-known/jwks.json",
      },
    },
    outbound: {
      auth: {
        client_id: "public-client-id",
        token_url: "https://example.com/oauth/token",
        public_key_ref: "public-key-id",
      },
    },
  }), true);
});

test("rejects nested secret values regardless of location", () => {
  for (const body of [
    { verification: { api_key: { secret: "hidden" } } },
    { attrs: { client_secret: "hidden" } },
    { routing: { mapping: { accessToken: "hidden" } } },
    { outbound: { auth: { password_ref: "hidden" } } },
    { custom: { bearer_token: "hidden" } },
    { api_key: "hidden" },
  ]) {
    assert.throws(
      () => assertConnectionProfileInputSafe(body),
      (error) => error.code === "CONNECTION_SECRET_IN_PROFILE_FORBIDDEN"
    );
  }
});

test("rejects persisted authentication headers", () => {
  assert.throws(
    () => assertConnectionProfileInputSafe({
      outbound: {
        default_headers: {
          Authorization: "Bearer hidden",
        },
      },
    }),
    (error) => error.code === "CONNECTION_SENSITIVE_HEADER_FORBIDDEN"
  );
});

test("bounds nested arrays and depth", () => {
  assert.throws(
    () => assertConnectionProfileInputSafe({ values: Array.from({ length: 501 }, () => "x") }),
    (error) => error.code === "CONNECTION_PROFILE_ARRAY_TOO_LARGE"
  );

  let nested = {};
  let cursor = nested;
  for (let index = 0; index < 25; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.throws(
    () => assertConnectionProfileInputSafe(nested),
    (error) => error.code === "CONNECTION_PROFILE_DEPTH_EXCEEDED"
  );
});
