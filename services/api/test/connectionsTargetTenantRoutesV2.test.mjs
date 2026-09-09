import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import connectionTargetRoutes from "../src/routes/connections_target.js";

const SESSION_TENANT = "11111111-1111-4111-8111-111111111111";
const TARGET_TENANT = "33333333-3333-4333-8333-333333333333";
const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const TARGET = Object.freeze({
  id: TARGET_TENANT,
  code: "tenant-b",
  name: "Tenant B",
  status: "active",
  kind: "customer",
  tenancy_model: "shared_schema_rls",
});

function session(overrides = {}) {
  return {
    tenant_id: SESSION_TENANT,
    identity_id: IDENTITY_ID,
    issued_at: new Date().toISOString(),
    attrs: { assurance: "otp" },
    ...overrides,
  };
}

async function buildApp({ permissionResolver = null, services = {} } = {}) {
  const app = Fastify({ logger: false });
  app.decorate("db", {});
  app.decorate("config", {
    CONNECTION_SECRET_STEP_UP_MIN: 10,
    CONNECTION_SECRET_ENCRYPTION_KEY: "11".repeat(32),
    CONNECTION_SECRET_KEY_ID: "test-key",
  });
  app.decorate("requirePermission", async (request, permissions, options) => {
    if (permissionResolver) return permissionResolver(request, permissions, options);
    return { ok: true, session: session() };
  });
  app.decorate("requireCsrf", async () => ({ ok: true }));
  await app.register(connectionTargetRoutes, { services });
  await app.ready();
  return app;
}

function baseServices(overrides = {}) {
  return {
    resolveConnectionTargetTenant: async (_db, tenantCode) =>
      tenantCode === TARGET.code ? TARGET : null,
    listConnectionTargetTenants: async () => [TARGET],
    assertConnectionProfileInputSafe: () => undefined,
    normalizeProfile: (body) => body,
    assertUniqueInboundPath: async () => undefined,
    loadConnectionTaxonomy: async () => ({}),
    toConnectionDetailDto: (item, secretStatus) => ({ ...item, credential_status: secretStatus }),
    toConnectionSummaryDto: (item) => item,
    ...overrides,
  };
}

test("tenant target catalogue is permission guarded and server supplied", async (t) => {
  const requested = [];
  const app = await buildApp({
    permissionResolver: async (_request, permissions) => {
      requested.push([...permissions]);
      return { ok: true, session: session() };
    },
    services: baseServices(),
  });
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/owner-admin/connections/tenants" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().items, [TARGET]);
  assert.deepEqual(requested, [["OWNER_ADMIN_CONNECTION_READ"]]);
});

test("owner admin can create a connection for a resolved target tenant without changing session tenant", async (t) => {
  let receivedTenantId = null;
  const app = await buildApp({
    services: baseServices({
      createConnectionProfile: async (_db, tenantId, body) => {
        receivedTenantId = tenantId;
        return {
          id: "profile-1",
          connection_code: body.identity.connection_code,
          identity: { ...body.identity, is_enabled: false },
          setting_status: "active",
        };
      },
    }),
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/owner-admin/connections/tenants/tenant-b",
    payload: {
      identity: {
        connection_code: "tenant_b_api",
        connection_name: "Tenant B API",
        is_enabled: false,
      },
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(receivedTenantId, TARGET_TENANT);
  assert.notEqual(receivedTenantId, SESSION_TENANT);
  assert.equal(response.json().target_tenant.code, "tenant-b");
});

test("target routes still reject browser tenant_id authority", async (t) => {
  let createCalled = false;
  const app = await buildApp({
    services: baseServices({
      assertConnectionProfileInputSafe: (body) => {
        if (Object.hasOwn(body, "tenant_id")) {
          const error = new Error("tenant_id forbidden");
          error.code = "CONNECTION_SERVER_OWNED_FIELD_FORBIDDEN";
          error.status = 400;
          error.path = "tenant_id";
          error.name = "ConnectionInputPolicyError";
          throw error;
        }
      },
      createConnectionProfile: async () => {
        createCalled = true;
        return {};
      },
    }),
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/owner-admin/connections/tenants/tenant-b",
    payload: {
      tenant_id: SESSION_TENANT,
      identity: { connection_code: "unsafe", is_enabled: false },
    },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(createCalled, false);
});

test("unknown or inactive target tenant fails closed", async (t) => {
  let listCalled = false;
  const app = await buildApp({
    services: baseServices({
      resolveConnectionTargetTenant: async () => null,
      listConnectionProfiles: async () => {
        listCalled = true;
        return [];
      },
    }),
  });
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/owner-admin/connections/tenants/missing" });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, "TENANT_NOT_FOUND");
  assert.equal(listCalled, false);
});

test("target secret rotation binds the resolved tenant and authenticated actor", async (t) => {
  let rotateArgs = null;
  const app = await buildApp({
    services: baseServices({
      withTenantTransaction: async (_db, tenantId, callback) => callback({}, { tenantId }),
      rotateSecret: async (args) => {
        rotateArgs = args;
        return { configured: true, status: "active", version: 1 };
      },
    }),
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/owner-admin/connections/tenants/tenant-b/example/secrets/api_key/rotate",
    payload: { value: "secret-value" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(rotateArgs.tenantId, TARGET_TENANT);
  assert.equal(rotateArgs.actorIdentityId, IDENTITY_ID);
  assert.equal(rotateArgs.plaintext, "secret-value");
  assert.equal(response.body.includes("secret-value"), false);
});
