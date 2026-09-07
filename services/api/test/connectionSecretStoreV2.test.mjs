import assert from "node:assert/strict";
import test from "node:test";
import {
  encryptValue,
  decryptRow,
  publicSecretStatus,
  resolveConnectionSecretConfig,
} from "../src/services/connections/connectionSecretStore.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const connectionCode = "secure_conn";
const secretKind = "api_key";
const keyHex = "11".repeat(32);

test("AES-256-GCM connection secret round-trips with bound AAD", () => {
  const { key, keyId } = resolveConnectionSecretConfig({
    CONNECTION_SECRET_ENCRYPTION_KEY: keyHex,
    CONNECTION_SECRET_KEY_ID: "test-v1",
  });
  const encrypted = encryptValue({
    plaintext: "super-secret-value",
    tenantId,
    connectionCode,
    secretKind,
    version: 1,
    key,
    keyId,
  });

  const plaintext = decryptRow({
    tenant_id: tenantId,
    connection_code: connectionCode,
    secret_kind: secretKind,
    version: 1,
    key_id: keyId,
    iv_b64: encrypted.iv_b64,
    auth_tag_b64: encrypted.auth_tag_b64,
    ciphertext_b64: encrypted.ciphertext_b64,
  }, key);

  assert.equal(plaintext, "super-secret-value");
  assert.equal(encrypted.fingerprint.length, 64);
  assert.notEqual(encrypted.ciphertext_b64, "super-secret-value");
});

test("AAD binds ciphertext to tenant connection kind and version", () => {
  const { key, keyId } = resolveConnectionSecretConfig({
    CONNECTION_SECRET_ENCRYPTION_KEY: keyHex,
  });
  const encrypted = encryptValue({
    plaintext: "bound-value",
    tenantId,
    connectionCode,
    secretKind,
    version: 1,
    key,
    keyId,
  });

  assert.throws(() => decryptRow({
    tenant_id: tenantId,
    connection_code: "other_conn",
    secret_kind: secretKind,
    version: 1,
    key_id: keyId,
    iv_b64: encrypted.iv_b64,
    auth_tag_b64: encrypted.auth_tag_b64,
    ciphertext_b64: encrypted.ciphertext_b64,
  }, key));
});

test("invalid or absent encryption key fails closed", () => {
  assert.throws(
    () => resolveConnectionSecretConfig({}),
    (error) => error.code === "CONNECTION_SECRET_KEY_UNAVAILABLE"
  );
  assert.throws(
    () => resolveConnectionSecretConfig({ CONNECTION_SECRET_ENCRYPTION_KEY: "short" }),
    (error) => error.code === "CONNECTION_SECRET_KEY_INVALID"
  );
});

test("secret value is bounded", () => {
  const { key, keyId } = resolveConnectionSecretConfig({ CONNECTION_SECRET_ENCRYPTION_KEY: keyHex });
  assert.throws(
    () => encryptValue({
      plaintext: "",
      tenantId,
      connectionCode,
      secretKind,
      version: 1,
      key,
      keyId,
    }),
    (error) => error.code === "CONNECTION_SECRET_VALUE_INVALID"
  );
  assert.throws(
    () => encryptValue({
      plaintext: "x".repeat(16_385),
      tenantId,
      connectionCode,
      secretKind,
      version: 1,
      key,
      keyId,
    }),
    (error) => error.code === "CONNECTION_SECRET_VALUE_INVALID"
  );
});

test("public secret status never exposes cryptographic material", () => {
  const projection = publicSecretStatus({
    status: "active",
    version: 4,
    fingerprint: "abc",
    created_at: "2026-09-07T00:00:00Z",
    revoked_at: null,
    iv_b64: "iv",
    auth_tag_b64: "tag",
    ciphertext_b64: "ciphertext",
    key_id: "key-v1",
  });

  assert.deepEqual(projection, {
    configured: true,
    status: "active",
    version: 4,
    fingerprint: "abc",
    last_rotated_at: "2026-09-07T00:00:00Z",
    revoked_at: null,
  });
  assert.equal("ciphertext_b64" in projection, false);
  assert.equal("iv_b64" in projection, false);
  assert.equal("auth_tag_b64" in projection, false);
  assert.equal("key_id" in projection, false);
});
