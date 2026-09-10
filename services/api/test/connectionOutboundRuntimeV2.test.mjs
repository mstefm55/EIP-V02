import assert from "node:assert/strict";
import test from "node:test";

import { encryptValue } from "../src/services/connections/connectionSecretStore.js";
import {
  ConnectionOutboundRuntimeError,
  buildConnectionRequestPlan,
  executeConnectionRequest,
} from "../src/services/connections/connectionOutboundRuntime.js";
import { executeGovernedConnectionRequest } from "../src/services/connections/connectionExecutionProfile.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_CODE = "conn-77";
const KEY_HEX = "42".repeat(32);
const KEY_ID = "connection-test-v1";
const CONFIG = {
  CONNECTION_SECRET_ENCRYPTION_KEY: KEY_HEX,
  CONNECTION_SECRET_KEY_ID: KEY_ID,
};

function encryptedSecretRow(secretKind, plaintext) {
  const encrypted = encryptValue({
    plaintext,
    tenantId: TENANT_ID,
    connectionCode: CONNECTION_CODE,
    secretKind,
    version: 1,
    key: Buffer.from(KEY_HEX, "hex"),
    keyId: KEY_ID,
  });
  return {
    tenant_id: TENANT_ID,
    connection_code: CONNECTION_CODE,
    secret_kind: secretKind,
    version: 1,
    key_id: KEY_ID,
    ...encrypted,
  };
}

function secretPool(secrets = {}) {
  const rows = Object.fromEntries(
    Object.entries(secrets).map(([kind, value]) => [kind, encryptedSecretRow(kind, value)])
  );
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
        const row = rows[params[2]] || null;
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      throw new Error(`Unexpected SQL in outbound runtime test: ${statement.slice(0, 120)}`);
    },
    release() {},
  };
  return {
    async connect() {
      return client;
    },
  };
}

function baseProfile(overrides = {}) {
  return {
    setting_status: "active",
    identity: {
      connection_code: CONNECTION_CODE,
      connection_name: "Runtime test",
      direction: "outbound",
      environment: "sandbox",
      is_enabled: true,
    },
    outbound: {
      base_url: "https://example.com",
      path_prefix: "",
      auth_mode: "none",
      auth: {},
      default_headers: {},
      timeout_ms: 5000,
      retry_policy: { max_retries: 0, backoff_ms: 50 },
    },
    audit: { max_body_size: 1_048_576 },
    attrs: {},
    ...overrides,
  };
}

function response(statusCode, body, headers = { "content-type": "application/json" }) {
  return {
    status_code: statusCode,
    headers,
    body_buffer: Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8"),
    latency_ms: 2,
    redirect_location: null,
  };
}

test("generic request plan consumes method path query headers body encoding and idempotency inputs", () => {
  const profile = baseProfile({
    outbound: {
      ...baseProfile().outbound,
      base_url: "https://api.example.com/root",
      path_prefix: "v2",
      default_headers: { "X-Account": "acct-1" },
      request: { idempotency_header_name: "Request-Id" },
    },
  });

  const plan = buildConnectionRequestPlan(profile, {
    method: "POST",
    path: "orders",
    query: { expand: ["customer", "items"], limit: 10 },
    headers: { "X-Operation": "create" },
    body: { amount: 1200, currency: "USD" },
    body_encoding: "json",
    content_type: "application/json",
    accept: "application/json",
    idempotency_key: "order-123",
  });

  assert.equal(plan.method, "POST");
  assert.equal(plan.url.pathname, "/root/v2/orders");
  assert.deepEqual(plan.url.searchParams.getAll("expand"), ["customer", "items"]);
  assert.equal(plan.url.searchParams.get("limit"), "10");
  assert.equal(plan.headers["X-Account"], "acct-1");
  assert.equal(plan.headers["X-Operation"], "create");
  assert.equal(plan.headers["Request-Id"], "order-123");
  assert.deepEqual(JSON.parse(plan.body.toString("utf8")), { amount: 1200, currency: "USD" });
});

test("caller cannot override destination or authentication transport headers", () => {
  const profile = baseProfile();
  assert.throws(
    () => buildConnectionRequestPlan(profile, { path: "https://evil.example/steal" }),
    (error) => error instanceof ConnectionOutboundRuntimeError && error.code === "CONNECTION_OUTBOUND_PATH_INVALID"
  );
  assert.throws(
    () => buildConnectionRequestPlan(profile, { headers: { Authorization: "Bearer browser-secret" } }),
    (error) => error instanceof ConnectionOutboundRuntimeError && error.code === "CONNECTION_OUTBOUND_HEADER_FORBIDDEN"
  );
  assert.throws(
    () => buildConnectionRequestPlan(profile, { headers: { Host: "evil.example" } }),
    (error) => error instanceof ConnectionOutboundRuntimeError && error.code === "CONNECTION_OUTBOUND_HEADER_FORBIDDEN"
  );
});

test("PayPal-style OAuth2 client-credentials exchange and API request are executable end to end", async () => {
  const pool = secretPool({ oauth_client_secret: "paypal-client-secret" });
  const profile = baseProfile({
    identity: {
      ...baseProfile().identity,
      connection_name: "PayPal sandbox",
    },
    outbound: {
      ...baseProfile().outbound,
      base_url: "https://api-m.sandbox.paypal.com",
      auth_mode: "oauth2_client_credentials",
      auth: {
        client_id: "paypal-client-id",
        token_url: "https://api-m.sandbox.paypal.com/v1/oauth2/token",
        scope: "https://uri.paypal.com/services/payments/payment/authcapture",
      },
    },
    attrs: {
      oauth_client_credentials: {
        client_auth_method: "basic",
        token_body_encoding: "form",
      },
      outbound_request: {
        body_encoding: "json",
        response_encoding: "auto",
        idempotency_header_name: "PayPal-Request-Id",
      },
    },
  });

  const calls = [];
  const transport = async (options) => {
    calls.push(options);
    if (calls.length === 1) {
      assert.equal(String(options.url), "https://api-m.sandbox.paypal.com/v1/oauth2/token");
      assert.equal(options.method, "POST");
      assert.equal(
        options.headers.Authorization,
        `Basic ${Buffer.from("paypal-client-id:paypal-client-secret", "utf8").toString("base64")}`
      );
      assert.match(options.headers["Content-Type"], /application\/x-www-form-urlencoded/);
      const tokenBody = new URLSearchParams(options.body.toString("utf8"));
      assert.equal(tokenBody.get("grant_type"), "client_credentials");
      assert.equal(
        tokenBody.get("scope"),
        "https://uri.paypal.com/services/payments/payment/authcapture"
      );
      assert.equal(tokenBody.has("client_secret"), false);
      return response(200, { access_token: "paypal-access-token", token_type: "Bearer", expires_in: 32400 });
    }

    assert.equal(options.method, "POST");
    const url = new URL(options.url);
    assert.equal(url.origin, "https://api-m.sandbox.paypal.com");
    assert.equal(url.pathname, "/v2/checkout/orders");
    assert.equal(url.searchParams.get("fields"), "payment_source");
    assert.equal(options.headers.Authorization, "Bearer paypal-access-token");
    assert.equal(options.headers["PayPal-Request-Id"], "order-request-001");
    assert.equal(options.headers["PayPal-Partner-Attribution-Id"], "PARTNER-123");
    assert.deepEqual(JSON.parse(options.body.toString("utf8")), {
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: "10.00" } }],
    });
    return response(201, { id: "ORDER-1", status: "CREATED" });
  };

  const result = await executeGovernedConnectionRequest({
    pool,
    tenantId: TENANT_ID,
    connectionCode: CONNECTION_CODE,
    config: CONFIG,
    request: {
      method: "POST",
      path: "/v2/checkout/orders",
      query: { fields: "payment_source" },
      headers: { "PayPal-Partner-Attribution-Id": "PARTNER-123" },
      body: {
        intent: "CAPTURE",
        purchase_units: [{ amount: { currency_code: "USD", value: "10.00" } }],
      },
      idempotency_key: "order-request-001",
    },
    services: {
      getConnectionProfile: async () => profile,
      performSafeHttpRequest: transport,
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(result.ok, true);
  assert.equal(result.status_code, 201);
  assert.deepEqual(result.body, { id: "ORDER-1", status: "CREATED" });
  assert.equal(JSON.stringify(result).includes("paypal-client-secret"), false);
  assert.equal(JSON.stringify(result).includes("paypal-access-token"), false);
});

test("Stripe-style bearer key, form payload, API-version header and idempotency key are executable", async () => {
  const pool = secretPool({ bearer_token: "sk_test_runtime_secret" });
  const profile = baseProfile({
    identity: {
      ...baseProfile().identity,
      connection_name: "Stripe test",
    },
    outbound: {
      ...baseProfile().outbound,
      base_url: "https://api.stripe.com",
      auth_mode: "bearer",
    },
    attrs: {
      outbound_request: {
        body_encoding: "form",
        response_encoding: "auto",
        idempotency_header_name: "Idempotency-Key",
      },
    },
  });

  let call;
  const transport = async (options) => {
    call = options;
    return response(200, { id: "pi_123", object: "payment_intent", status: "requires_payment_method" });
  };

  const result = await executeGovernedConnectionRequest({
    pool,
    tenantId: TENANT_ID,
    connectionCode: CONNECTION_CODE,
    config: CONFIG,
    request: {
      method: "POST",
      path: "/v1/payment_intents",
      headers: { "Stripe-Version": "2025-06-30.basil" },
      body: {
        amount: 2000,
        currency: "usd",
        "payment_method_types[]": ["card"],
        "metadata[source]": "eip",
      },
      idempotency_key: "stripe-request-001",
    },
    services: {
      getConnectionProfile: async () => profile,
      performSafeHttpRequest: transport,
    },
  });

  assert.equal(call.method, "POST");
  assert.equal(new URL(call.url).pathname, "/v1/payment_intents");
  assert.equal(call.headers.Authorization, "Bearer sk_test_runtime_secret");
  assert.equal(call.headers["Stripe-Version"], "2025-06-30.basil");
  assert.equal(call.headers["Idempotency-Key"], "stripe-request-001");
  assert.match(call.headers["Content-Type"], /application\/x-www-form-urlencoded/);
  const form = new URLSearchParams(call.body.toString("utf8"));
  assert.equal(form.get("amount"), "2000");
  assert.equal(form.get("currency"), "usd");
  assert.deepEqual(form.getAll("payment_method_types[]"), ["card"]);
  assert.equal(form.get("metadata[source]"), "eip");
  assert.equal(result.ok, true);
  assert.equal(result.body.id, "pi_123");
  assert.equal(JSON.stringify(result).includes("sk_test_runtime_secret"), false);
});

test("retry policy retries safe methods and idempotent writes but not unsafe unkeyed writes", async () => {
  const pool = secretPool();
  const retryProfile = baseProfile({
    outbound: {
      ...baseProfile().outbound,
      retry_policy: { max_retries: 2, backoff_ms: 50 },
    },
  });

  let getCalls = 0;
  const getResult = await executeConnectionRequest({
    pool,
    tenantId: TENANT_ID,
    connectionCode: CONNECTION_CODE,
    services: {
      getConnectionProfile: async () => retryProfile,
      performSafeHttpRequest: async () => {
        getCalls += 1;
        return getCalls === 1 ? response(503, { error: "busy" }) : response(200, { ok: true });
      },
      sleep: async () => {},
    },
  });
  assert.equal(getCalls, 2);
  assert.equal(getResult.attempts, 2);

  let postCalls = 0;
  const postResult = await executeConnectionRequest({
    pool,
    tenantId: TENANT_ID,
    connectionCode: CONNECTION_CODE,
    request: { method: "POST", body: { value: 1 }, idempotency_key: "write-1" },
    services: {
      getConnectionProfile: async () => retryProfile,
      performSafeHttpRequest: async () => {
        postCalls += 1;
        return postCalls === 1 ? response(503, { error: "busy" }) : response(200, { ok: true });
      },
      sleep: async () => {},
    },
  });
  assert.equal(postCalls, 2);
  assert.equal(postResult.attempts, 2);

  let unsafeCalls = 0;
  const unsafeResult = await executeConnectionRequest({
    pool,
    tenantId: TENANT_ID,
    connectionCode: CONNECTION_CODE,
    request: { method: "POST", body: { value: 1 } },
    services: {
      getConnectionProfile: async () => retryProfile,
      performSafeHttpRequest: async () => {
        unsafeCalls += 1;
        return response(503, { error: "busy" });
      },
      sleep: async () => {},
    },
  });
  assert.equal(unsafeCalls, 1);
  assert.equal(unsafeResult.attempts, 1);
  assert.equal(unsafeResult.status_code, 503);
});
