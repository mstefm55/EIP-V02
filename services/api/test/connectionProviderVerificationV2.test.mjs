import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { encryptValue } from "../src/services/connections/connectionSecretStore.js";
import {
  ConnectionProviderVerificationError,
  assertPaypalCertificateUrl,
  crc32Decimal,
  parseStripeSignatureHeader,
  verifyPayPalProviderSignature,
  verifyProviderSignature,
  verifyStripeProviderSignature,
} from "../src/services/connections/connectionProviderVerification.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_CODE = "conn-88";
const KEY_HEX = "24".repeat(32);
const KEY_ID = "connection-provider-test-v1";
const CONFIG = {
  CONNECTION_SECRET_ENCRYPTION_KEY: KEY_HEX,
  CONNECTION_SECRET_KEY_ID: KEY_ID,
};

function secretPool(secretKind, plaintext) {
  const encrypted = encryptValue({
    plaintext,
    tenantId: TENANT_ID,
    connectionCode: CONNECTION_CODE,
    secretKind,
    version: 1,
    key: Buffer.from(KEY_HEX, "hex"),
    keyId: KEY_ID,
  });
  const row = {
    tenant_id: TENANT_ID,
    connection_code: CONNECTION_CODE,
    secret_kind: secretKind,
    version: 1,
    key_id: KEY_ID,
    ...encrypted,
  };
  const client = {
    async query(sql, params = []) {
      const statement = String(sql).trim();
      if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") {
        return { rowCount: 0, rows: [] };
      }
      if (statement.startsWith("SELECT set_config('app.current_tenant_id'")) {
        assert.equal(params[0], TENANT_ID);
        return { rowCount: 1, rows: [] };
      }
      if (statement.includes("FROM tenant.connection_secret")) {
        const matched = params[2] === secretKind;
        return { rowCount: matched ? 1 : 0, rows: matched ? [row] : [] };
      }
      throw new Error(`Unexpected SQL in provider verification test: ${statement.slice(0, 120)}`);
    },
    release() {},
  };
  return {
    async connect() {
      return client;
    },
  };
}

function profile(provider, extra = {}) {
  return {
    identity: {
      connection_code: CONNECTION_CODE,
      direction: "inbound",
      environment: "production",
      is_enabled: true,
    },
    verification: {
      mode: "provider_signature",
      provider_signature: {
        provider_code: provider,
        max_skew_sec: 300,
        ...(extra.provider_signature || {}),
      },
    },
    routing: { provider_code: provider },
  };
}

test("Stripe provider verifier consumes raw body, signature header, timestamp and encrypted signing secret", async () => {
  const signingSecret = "whsec_test_only_not_real";
  const pool = secretPool("webhook_signing_secret", signingSecret);
  const now = Date.parse("2026-09-10T20:00:00.000Z");
  const timestamp = Math.floor(now / 1000);
  const rawBody = Buffer.from(JSON.stringify({ id: "evt_test_1", type: "payment_intent.succeeded" }), "utf8");
  const digest = crypto
    .createHmac("sha256", signingSecret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), rawBody]))
    .digest("hex");
  const signatureHeader = `t=${timestamp},v1=0000000000000000000000000000000000000000000000000000000000000000,v1=${digest}`;

  const parsed = parseStripeSignatureHeader(signatureHeader);
  assert.equal(parsed.timestamp, timestamp);
  assert.equal(parsed.signatures.length, 2);

  const result = await verifyStripeProviderSignature({
    pool,
    tenantId: TENANT_ID,
    profile: profile("stripe"),
    headers: { "stripe-signature": signatureHeader },
    rawBody,
    config: CONFIG,
    now,
  });

  assert.deepEqual(result, {
    verified: true,
    mode: "provider_signature",
    assurance: "provider_signature",
    provider: "stripe",
  });
});

test("Stripe verifier rejects stale or invalid provider signatures", async () => {
  const signingSecret = "whsec_test_only_not_real";
  const pool = secretPool("webhook_signing_secret", signingSecret);
  const now = Date.parse("2026-09-10T20:00:00.000Z");
  const staleTimestamp = Math.floor((now - 600_000) / 1000);
  const rawBody = Buffer.from("{}", "utf8");
  const digest = crypto
    .createHmac("sha256", signingSecret)
    .update(Buffer.concat([Buffer.from(`${staleTimestamp}.`, "utf8"), rawBody]))
    .digest("hex");

  await assert.rejects(
    () => verifyStripeProviderSignature({
      pool,
      tenantId: TENANT_ID,
      profile: profile("stripe"),
      headers: { "stripe-signature": `t=${staleTimestamp},v1=${digest}` },
      rawBody,
      config: CONFIG,
      now,
    }),
    (error) => error instanceof ConnectionProviderVerificationError
      && error.code === "CONNECTION_STRIPE_SIGNATURE_TIMESTAMP_INVALID"
  );
});

test("PayPal provider verifier consumes all transmission headers, webhook ID, raw event body and trusted certificate", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const now = Date.parse("2026-09-10T20:00:00.000Z");
  const transmissionId = "paypal-transmission-123";
  const transmissionTime = new Date(now).toISOString();
  const webhookId = "WH-TEST-123";
  const rawBody = Buffer.from(JSON.stringify({ id: "WH-EVENT-1", event_type: "PAYMENT.CAPTURE.COMPLETED" }), "utf8");
  const message = `${transmissionId}|${transmissionTime}|${webhookId}|${crc32Decimal(rawBody)}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(message, "utf8");
  signer.end();
  const signature = signer.sign(privateKey).toString("base64");

  let certificateRequest = null;
  const result = await verifyPayPalProviderSignature({
    profile: profile("paypal", { provider_signature: { webhook_id: webhookId } }),
    headers: {
      "paypal-transmission-id": transmissionId,
      "paypal-transmission-time": transmissionTime,
      "paypal-cert-url": "https://api.paypal.com/certs/test.pem",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-transmission-sig": signature,
    },
    rawBody,
    now,
    transport: async (options) => {
      certificateRequest = options;
      return {
        status_code: 200,
        headers: { "content-type": "application/x-pem-file" },
        body_buffer: Buffer.from(publicKey, "utf8"),
        latency_ms: 1,
        redirect_location: null,
      };
    },
  });

  assert.equal(String(certificateRequest.url), "https://api.paypal.com/certs/test.pem");
  assert.equal(certificateRequest.method, "GET");
  assert.equal(result.verified, true);
  assert.equal(result.provider, "paypal");
});

test("PayPal certificate URL is restricted to HTTPS PayPal hosts", () => {
  assert.equal(assertPaypalCertificateUrl("https://api.paypal.com/cert.pem").hostname, "api.paypal.com");
  for (const url of [
    "http://api.paypal.com/cert.pem",
    "https://paypal.com.evil.example/cert.pem",
    "https://evilpaypal.com/cert.pem",
    "https://127.0.0.1/cert.pem",
  ]) {
    assert.throws(
      () => assertPaypalCertificateUrl(url),
      (error) => error instanceof ConnectionProviderVerificationError
    );
  }
});

test("provider signature dispatcher fails closed for unknown adapters", async () => {
  await assert.rejects(
    () => verifyProviderSignature({ profile: profile("unknown") }),
    (error) => error instanceof ConnectionProviderVerificationError
      && error.code === "CONNECTION_PROVIDER_SIGNATURE_UNSUPPORTED"
  );
});
