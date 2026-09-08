import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import publicConnectionRoutes from "../src/routes/public_connections.js";
import { ConnectionInboundRuntimeError } from "../src/services/connections/connectionInboundRuntime.js";

const TENANT = "11111111-1111-4111-8111-111111111111";

function resolvedProfile() {
  return {
    tenant: { tenant_id: TENANT, tenant_code: "TENANT_A" },
    profile: {
      identity: {
        connection_code: "orders_api",
        direction: "inbound",
        environment: "production",
        is_enabled: true,
      },
      inbound: {
        webhook_enabled: true,
        inbound_path_suffix: "orders",
        http_method: "POST",
        expected_content_type: "application/json",
      },
      verification: {
        mode: "api_key",
        api_key: { header_name: "x-api-key" },
      },
      routing: { channel: "website_intake" },
      idempotency: {
        event_id_location: "header",
        event_id_key: "x-event-id",
        idempotency_scope: "connection",
      },
    },
  };
}

async function buildApp(services) {
  const app = Fastify({ logger: false });
  app.decorate("db", {});
  app.decorate("config", {});
  await app.register(publicConnectionRoutes, { services });
  await app.ready();
  return app;
}

test("public inbound route returns a bounded duplicate response and suppresses further dispatch", async (t) => {
  const claims = [];
  const app = await buildApp({
    resolvePublicConnection: async () => resolvedProfile(),
    assertInboundRequestAllowed: () => true,
    verifyInboundRequest: async () => ({
      verified: true,
      mode: "api_key",
      assurance: "shared_secret",
    }),
    claimInboundReceipt: async (input) => {
      claims.push(input);
      return {
        duplicate: true,
        receipt_id: "22222222-2222-4222-8222-222222222222",
        accepted_at: "2026-09-08T19:00:00.000Z",
      };
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/public/gateway/intake/TENANT_A/orders?source=test",
    headers: {
      "content-type": "application/json",
      "x-api-key": "not-logged-by-test",
      "x-event-id": "evt-1",
    },
    payload: JSON.stringify({ value: 5 }),
  });

  assert.equal(response.statusCode, 202);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.accepted, true);
  assert.equal(body.duplicate, true);
  assert.equal(body.dispatch_status, "DUPLICATE_SUPPRESSED");
  assert.equal(body.receipt_id, "22222222-2222-4222-8222-222222222222");
  assert.equal(claims.length, 1);
  assert.equal(claims[0].tenantId, TENANT);
  assert.equal(claims[0].profile.identity.connection_code, "orders_api");
  assert.equal(claims[0].request.query.source, "test");
  assert.equal(Buffer.isBuffer(claims[0].request.rawBody), true);
});

test("public inbound route returns 409 when an event ID is reused with a different payload", async (t) => {
  const app = await buildApp({
    resolvePublicConnection: async () => resolvedProfile(),
    assertInboundRequestAllowed: () => true,
    verifyInboundRequest: async () => ({
      verified: true,
      mode: "hmac_signature",
      assurance: "signed_payload",
    }),
    claimInboundReceipt: async () => {
      throw new ConnectionInboundRuntimeError(
        "The inbound event ID was already used with a different payload.",
        "IDEMPOTENCY_CONFLICT",
        409
      );
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/public/gateway/intake/TENANT_A/orders",
    headers: {
      "content-type": "application/json",
      "x-event-id": "evt-1",
    },
    payload: JSON.stringify({ value: 6 }),
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error, "IDEMPOTENCY_CONFLICT");
});
