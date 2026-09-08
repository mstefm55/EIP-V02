import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import connectionRoutes from "../src/routes/connections.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

function session(overrides = {}) {
  return {
    tenant_id: TENANT,
    identity_id: ACTOR,
    issued_at: new Date().toISOString(),
    attrs: { assurance: "otp" },
    ...overrides,
  };
}

async function buildApp({ permissionResolver, csrf = { ok: true }, services = {} } = {}) {
  const app = Fastify({ logger: false });
  app.decorate("db", {});
  app.decorate("config", {
    CONNECTION_SECRET_STEP_UP_MIN: 10,
    CONNECTION_SECRET_ENCRYPTION_KEY: "11".repeat(32),
  });
  app.decorate("requirePermission", async (request, permissions, options) => {
    if (permissionResolver) return permissionResolver(request, permissions, options);
    return { ok: true, session: session() };
  });
  app.decorate("requireCsrf", async () => csrf);
  await app.register(connectionRoutes, { services });
  await app.ready();
  return app;
}

test("DELETE connection requires write permission and authenticated tenant scope", async (t) => {
  let args = null;
  const requested = [];
  const app = await buildApp({
    permissionResolver: async (_request, permissions) => {
      requested.push([...permissions]);
      return { ok: true, session: session() };
    },
    services: {
      deprecateConnectionProfile: async (_db, tenantId, code, actorIdentityId) => {
        args = { tenantId, code, actorIdentityId };
        return { connection_code: code, status: "deprecated" };
      },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "DELETE",
    url: "/owner-admin/connections/sample_conn",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(requested, [["OWNER_ADMIN_CONNECTION_WRITE"]]);
  assert.deepEqual(args, {
    tenantId: TENANT,
    code: "sample_conn",
    actorIdentityId: ACTOR,
  });
  assert.equal(response.json().item.status, "deprecated");
});

test("DELETE connection fails closed before lifecycle mutation when CSRF fails", async (t) => {
  let called = false;
  const app = await buildApp({
    csrf: { ok: false, status: 403, error: "CSRF_MISSING" },
    services: {
      deprecateConnectionProfile: async () => {
        called = true;
        return {};
      },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({ method: "DELETE", url: "/owner-admin/connections/sample_conn" });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, "CSRF_MISSING");
  assert.equal(called, false);
});

test("API key generator uses secret permission, fresh assurance and returns plaintext only once", async (t) => {
  const plaintext = "eip_generated-once-value";
  let args = null;
  const requested = [];
  const app = await buildApp({
    permissionResolver: async (_request, permissions) => {
      requested.push([...permissions]);
      return { ok: true, session: session() };
    },
    services: {
      withTenantTransaction: async (_db, tenantId, callback) => callback({ query: async () => ({ rows: [], rowCount: 0 }) }, { tenantId }),
      generateConnectionApiKey: async (input) => {
        args = input;
        return {
          value: plaintext,
          secret: {
            configured: true,
            status: "active",
            version: 1,
            fingerprint: "safe-fingerprint",
          },
        };
      },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/owner-admin/connections/sample_conn/api-key/generate",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(requested, [["OWNER_ADMIN_CONNECTION_SECRET_MANAGE"]]);
  assert.equal(args.tenantId, TENANT);
  assert.equal(args.connectionCode, "sample_conn");
  assert.equal(args.actorIdentityId, ACTOR);
  assert.equal(response.json().raw_key, plaintext);
  assert.equal(response.json().shown_once, true);
  assert.equal(response.json().api_key.fingerprint, "safe-fingerprint");
  assert.equal(response.body.includes("ciphertext"), false);
  assert.equal(response.body.includes("auth_tag"), false);
  assert.equal(response.body.includes("iv_b64"), false);
});

test("API key generator rejects stale or low assurance before generating", async (t) => {
  let called = false;
  const app = await buildApp({
    permissionResolver: async () => ({
      ok: true,
      session: session({ attrs: { assurance: "password" } }),
    }),
    services: {
      withTenantTransaction: async (_db, tenantId, callback) => callback({}, { tenantId }),
      generateConnectionApiKey: async () => {
        called = true;
        return {};
      },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/owner-admin/connections/sample_conn/api-key/generate",
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, "STEP_UP_REQUIRED");
  assert.equal(called, false);
});
