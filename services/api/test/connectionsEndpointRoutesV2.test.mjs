import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import connectionEndpointRoutes, {
  buildEndpointProjection,
} from "../src/routes/connections_endpoints.js";

const TENANT = "11111111-1111-4111-8111-111111111111";

function readyProfile(overrides = {}) {
  return {
    identity: {
      connection_code: "orders_api",
      direction: "inbound",
      environment: "production",
      is_enabled: true,
      ...(overrides.identity || {}),
    },
    inbound: {
      inbound_path_suffix: "orders",
      webhook_enabled: true,
      ...(overrides.inbound || {}),
    },
    verification: {
      mode: "api_key",
      ...(overrides.verification || {}),
    },
    routing: {
      channel: "website_intake",
      ...(overrides.routing || {}),
    },
    setting_status: "active",
  };
}

async function buildApp({ services = {}, permission = { ok: true } } = {}) {
  const dbCalls = [];
  const app = Fastify({ logger: false });
  app.decorate("db", {
    query: async (_sql, params) => {
      dbCalls.push(params);
      return { rowCount: 1, rows: [{ tenant_code: "TENANT_A" }] };
    },
  });
  app.decorate("requirePermission", async (_req, requested) => (
    permission.ok === false
      ? permission
      : {
        ok: true,
        session: {
          tenant_id: TENANT,
          identity_id: "22222222-2222-4222-8222-222222222222",
          permissions: requested,
        },
      }
  ));
  await app.register(connectionEndpointRoutes, { services });
  await app.ready();
  return { app, dbCalls };
}

test("endpoint projection uses the authenticated tenant only", async (t) => {
  const calls = [];
  const { app, dbCalls } = await buildApp({
    services: {
      getConnectionProfile: async (_db, tenantId, code) => {
        calls.push(["profile", tenantId, code]);
        return readyProfile();
      },
      withTenantTransaction: async (_db, tenantId, callback) => {
        calls.push(["transaction", tenantId]);
        return callback({});
      },
      listSecretStatuses: async (_client, tenantId, code) => {
        calls.push(["secrets", tenantId, code]);
        return { api_key: { configured: true, status: "active" } };
      },
      buildInboundReadiness: () => ({
        configured: true,
        activation_ready: true,
        runtime_available: true,
        runtime_status: "AVAILABLE",
      }),
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/owner-admin/connections/orders_api/endpoints",
    headers: { host: "eip.example.com" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [
    ["profile", TENANT, "orders_api"],
    ["transaction", TENANT],
    ["secrets", TENANT, "orders_api"],
  ]);
  assert.deepEqual(dbCalls, [[TENANT]]);
  const body = response.json();
  assert.equal(body.endpoints.tenant_code, "TENANT_A");
  assert.equal(body.endpoints.runtime_available, true);
  assert.equal(
    body.endpoints.public_intake_url,
    "http://eip.example.com/api/public/gateway/intake/TENANT_A/orders"
  );
  assert.equal(body.endpoints.edi_webhook_url, null);
});

test("endpoint projection exposes the EDI URL only for EDI connections", () => {
  const endpoints = buildEndpointProjection({
    origin: "https://eip.example.com",
    tenantCode: "TENANT_A",
    profile: readyProfile({ routing: { channel: "edi" } }),
    readiness: {
      configured: true,
      activation_ready: true,
      runtime_available: true,
      runtime_status: "AVAILABLE",
    },
  });

  assert.equal(endpoints.public_intake_url, null);
  assert.equal(
    endpoints.edi_webhook_url,
    "https://eip.example.com/api/edi/gateway/webhook/TENANT_A/orders"
  );
});

test("endpoint projection fails closed on missing read permission", async (t) => {
  let called = false;
  const { app } = await buildApp({
    permission: {
      ok: false,
      status: 403,
      error: "PERMISSION_REQUIRED",
      required_permissions: ["OWNER_ADMIN_CONNECTION_READ"],
    },
    services: {
      getConnectionProfile: async () => {
        called = true;
        return readyProfile();
      },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/owner-admin/connections/orders_api/endpoints",
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, "PERMISSION_REQUIRED");
  assert.equal(called, false);
});
