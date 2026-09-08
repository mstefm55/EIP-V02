import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import connectionRoutes from "../src/routes/connections.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const IDENTITY = "22222222-2222-4222-8222-222222222222";

async function buildApp(services) {
  const app = Fastify({ logger: false });
  app.decorate("db", {});
  app.decorate("config", {});
  app.decorate("requirePermission", async () => ({
    ok: true,
    session: {
      tenant_id: TENANT,
      identity_id: IDENTITY,
      issued_at: new Date().toISOString(),
      attrs: { assurance: "otp" },
    },
  }));
  app.decorate("requireCsrf", async () => ({ ok: true }));
  await app.register(connectionRoutes, { services });
  await app.ready();
  return app;
}

test("PATCH wires credential readiness to updateConnectionProfile using the same tenant client", async (t) => {
  const tenantClient = { query: async () => ({ rowCount: 0, rows: [] }) };
  const secretReads = [];
  let updateArgs = null;

  const app = await buildApp({
    assertConnectionProfileInputSafe: () => true,
    loadConnectionTaxonomy: async () => ({ CONNECTION_KIND: [{ code: "custom" }] }),
    updateConnectionProfile: async (_db, tenantId, code, body, taxonomy, options) => {
      updateArgs = { tenantId, code, body, taxonomy, options };
      const statuses = await options.loadCredentialStatuses(tenantClient, tenantId, code);
      assert.equal(statuses.api_key.status, "active");
      return {
        id: "profile-1",
        identity: {
          connection_code: code,
          connection_name: "Orders",
          is_enabled: body.identity.is_enabled === true,
        },
        health: {},
      };
    },
    listSecretStatuses: async (client, tenantId, code) => {
      secretReads.push({ client, tenantId, code });
      return {
        api_key: {
          configured: true,
          status: "active",
          version: 1,
          fingerprint: "safe-fingerprint",
        },
      };
    },
    withTenantTransaction: async (_db, tenantId, callback) => {
      assert.equal(tenantId, TENANT);
      return callback(tenantClient, { tenantId });
    },
    toConnectionDetailDto: (item, statuses) => ({ ...item, credential_status: statuses }),
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "PATCH",
    url: "/owner-admin/connections/orders",
    payload: { identity: { is_enabled: true } },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(updateArgs.tenantId, TENANT);
  assert.equal(updateArgs.code, "orders");
  assert.equal(updateArgs.body.identity.is_enabled, true);
  assert.equal(typeof updateArgs.options.loadCredentialStatuses, "function");
  assert.equal(secretReads.length, 2);
  assert.equal(secretReads[0].client, tenantClient);
  assert.equal(secretReads[0].tenantId, TENANT);
  assert.equal(secretReads[0].code, "orders");
  assert.equal(response.json().item.identity.is_enabled, true);
  assert.equal(response.json().item.credential_status.api_key.status, "active");
});
