import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import connectionRoutes, { requireFreshSecretAssurance } from "../src/routes/connections.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const IDENTITY_A = "22222222-2222-4222-8222-222222222222";

function session(overrides = {}) {
  return {
    tenant_id: TENANT_A,
    identity_id: IDENTITY_A,
    issued_at: new Date().toISOString(),
    attrs: { assurance: "otp" },
    ...overrides,
  };
}

async function buildRouteApp({ permission = { ok: true, session: session() }, csrf = { ok: true }, services = {} } = {}) {
  const app = Fastify({ logger: false });
  app.decorate("db", {});
  app.decorate("config", {
    CONNECTION_SECRET_STEP_UP_MIN: 10,
    CONNECTION_SECRET_ENCRYPTION_KEY: "11".repeat(32),
    CONNECTION_SECRET_KEY_ID: "test-key",
  });
  app.decorate("requirePermission", async () => permission);
  app.decorate("requireCsrf", async () => csrf);
  await app.register(connectionRoutes, { services });
  await app.ready();
  return app;
}

test("fresh OTP/TOTP assurance is required for secret mutations", () => {
  const now = Date.now();
  assert.equal(requireFreshSecretAssurance({ attrs: { assurance: "otp" }, issued_at: new Date(now - 60_000) }, {}, now).ok, true);
  assert.equal(requireFreshSecretAssurance({ attrs: { assurance: "totp" }, issued_at: new Date(now - 60_000) }, {}, now).ok, true);
  assert.deepEqual(
    requireFreshSecretAssurance({ attrs: { assurance: "password" }, issued_at: new Date(now) }, {}, now),
    { ok: false, status: 403, error: "STEP_UP_REQUIRED" }
  );
  assert.deepEqual(
    requireFreshSecretAssurance({ attrs: { assurance: "otp" }, issued_at: new Date(now - 11 * 60_000) }, {}, now),
    { ok: false, status: 403, error: "STEP_UP_REQUIRED" }
  );
});

test("profile creation uses authenticated session tenant and never accepts browser tenant authority", async (t) => {
  let createCalls = 0;
  let receivedTenant = null;
  const app = await buildRouteApp({
    services: {
      loadConnectionTaxonomy: async () => ({}),
      createConnectionProfile: async (_db, tenantId, body) => {
        createCalls += 1;
        receivedTenant = tenantId;
        return {
          id: "profile-1",
          profile_version: 1,
          identity: { ...body.identity },
          health: {},
          credential_status: {},
        };
      },
    },
  });
  t.after(() => app.close());

  const unsafe = await app.inject({
    method: "POST",
    url: "/owner-admin/connections",
    payload: {
      tenant_id: "33333333-3333-4333-8333-333333333333",
      identity: { connection_code: "safe_code", connection_name: "Safe" },
    },
  });
  assert.equal(unsafe.statusCode, 400);
  assert.equal(unsafe.json().error, "CONNECTION_SERVER_OWNED_FIELD_FORBIDDEN");
  assert.equal(createCalls, 0);

  const safe = await app.inject({
    method: "POST",
    url: "/owner-admin/connections",
    payload: {
      identity: { connection_code: "safe_code", connection_name: "Safe" },
    },
  });
  assert.equal(safe.statusCode, 201);
  assert.equal(receivedTenant, TENANT_A);
  assert.equal(createCalls, 1);
});

test("profile writes fail closed when CSRF validation fails", async (t) => {
  let called = false;
  const app = await buildRouteApp({
    csrf: { ok: false, status: 403, error: "CSRF_MISSING" },
    services: {
      loadConnectionTaxonomy: async () => ({}),
      createConnectionProfile: async () => {
        called = true;
        return {};
      },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/owner-admin/connections",
    payload: { identity: { connection_code: "safe_code" } },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, "CSRF_MISSING");
  assert.equal(called, false);
});

test("connections fail closed when owner-admin permission is absent", async (t) => {
  const app = await buildRouteApp({
    permission: {
      ok: false,
      status: 403,
      error: "PERMISSION_REQUIRED",
      required_permissions: ["OWNER_ADMIN_CONSOLE_READ"],
    },
  });
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/owner-admin/connections" });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, "PERMISSION_REQUIRED");
});

test("secret rotation response never echoes submitted plaintext", async (t) => {
  const plaintext = "never-return-this-secret";
  let rotateArgs = null;
  const app = await buildRouteApp({
    services: {
      withTenantTransaction: async (_db, tenantId, callback) => callback({ query: async () => ({ rows: [], rowCount: 0 }) }, { tenantId }),
      rotateSecret: async (args) => {
        rotateArgs = args;
        return {
          configured: true,
          status: "active",
          version: 3,
          fingerprint: "fingerprint-only",
          last_rotated_at: new Date().toISOString(),
          revoked_at: null,
        };
      },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/owner-admin/connections/example/secrets/api_key/rotate",
    payload: { value: plaintext },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(rotateArgs.tenantId, TENANT_A);
  assert.equal(rotateArgs.actorIdentityId, IDENTITY_A);
  assert.equal(rotateArgs.plaintext, plaintext);
  assert.equal(response.body.includes(plaintext), false);
  assert.equal(response.json().secret.configured, true);
});

test("secret rotation requires a recent high-assurance session", async (t) => {
  let called = false;
  const app = await buildRouteApp({
    permission: { ok: true, session: session({ attrs: { assurance: "password" } }) },
    services: {
      withTenantTransaction: async (_db, _tenantId, callback) => callback({ query: async () => ({ rows: [], rowCount: 0 }) }),
      rotateSecret: async () => {
        called = true;
        return {};
      },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/owner-admin/connections/example/secrets/api_key/rotate",
    payload: { value: "secret" },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, "STEP_UP_REQUIRED");
  assert.equal(called, false);
});
