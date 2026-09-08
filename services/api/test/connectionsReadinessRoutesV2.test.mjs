import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import connectionReadinessRoutes from "../src/routes/connections_readiness.js";

const TENANT = "11111111-1111-4111-8111-111111111111";

async function buildApp({ csrf = { ok: true }, services = {}, session = null } = {}) {
  const app = Fastify({ logger: false });
  app.decorate("db", {});
  app.decorate("requirePermission", async (_request, permissions) => ({
    ok: true,
    session: session || {
      tenant_id: TENANT,
      identity_id: "22222222-2222-4222-8222-222222222222",
      permissions,
    },
  }));
  app.decorate("requireCsrf", async () => csrf);
  await app.register(connectionReadinessRoutes, { services });
  await app.ready();
  return app;
}

test("inbound readiness resolves profile and credentials only in session tenant", async (t) => {
  const calls = [];
  const app = await buildApp({
    services: {
      getConnectionProfile: async (_db, tenantId, code) => {
        calls.push(["profile", tenantId, code]);
        return {
          identity: { direction: "inbound", environment: "sandbox" },
          inbound: { inbound_path_suffix: "orders", http_method: "POST", expected_content_type: "application/json" },
          verification: { mode: "none", allow_unverified: false },
          setting_status: "active",
        };
      },
      withTenantTransaction: async (_db, tenantId, callback) => {
        calls.push(["transaction", tenantId]);
        return callback({}, { tenantId });
      },
      listSecretStatuses: async (_client, tenantId, code) => {
        calls.push(["secrets", tenantId, code]);
        return {};
      },
      buildInboundReadiness: () => ({ configured: true, runtime_available: false }),
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/owner-admin/connections/sample_conn/test/inbound-readiness",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [
    ["profile", TENANT, "sample_conn"],
    ["transaction", TENANT],
    ["secrets", TENANT, "sample_conn"],
  ]);
  assert.equal(response.json().result.runtime_available, false);
});

test("inbound readiness requires CSRF before reading connection state", async (t) => {
  let called = false;
  const app = await buildApp({
    csrf: { ok: false, status: 403, error: "CSRF_MISSING" },
    services: {
      getConnectionProfile: async () => {
        called = true;
        return {};
      },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/owner-admin/connections/sample_conn/test/inbound-readiness",
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, "CSRF_MISSING");
  assert.equal(called, false);
});
