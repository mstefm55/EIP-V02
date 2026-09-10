import assert from "node:assert/strict";
import Fastify from "fastify";
import test from "node:test";

import connectionExecutionRoutes, {
  capabilityProjection,
} from "../src/routes/connections_execution.js";

const SESSION_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_TENANT_ID = "22222222-2222-4222-8222-222222222222";
const IDENTITY_ID = "33333333-3333-4333-8333-333333333333";

async function buildApp({ permissionOk = true, csrfOk = true, services = {} } = {}) {
  const app = Fastify({ logger: false });
  app.decorate("db", {});
  app.decorate("requirePermission", async (_req, permissions) => ({
    ok: permissionOk,
    status: permissionOk ? 200 : 403,
    error: permissionOk ? null : "FORBIDDEN",
    required_permissions: permissionOk ? [] : permissions,
    session: permissionOk
      ? { tenant_id: SESSION_TENANT_ID, identity_id: IDENTITY_ID, permissions: permissions || [] }
      : null,
  }));
  app.decorate("requireCsrf", async () => ({
    ok: csrfOk,
    status: csrfOk ? 200 : 403,
    error: csrfOk ? null : "CSRF_INVALID",
  }));
  await app.register(connectionExecutionRoutes, { services });
  await app.ready();
  return app;
}

test("capability contract declares both request inputs and consuming runtime functions", () => {
  const capabilities = capabilityProjection();
  assert.equal(capabilities.transport, "http");
  for (const key of [
    "path",
    "query",
    "headers",
    "body",
    "body_encoding",
    "content_type",
    "accept",
    "response_encoding",
    "idempotency_key",
  ]) {
    assert.equal(capabilities.request_input[key], true, `${key} is not exposed as an execution input`);
  }
  assert.equal(capabilities.functions.plan, "planGovernedConnectionRequest");
  assert.equal(capabilities.functions.execute, "executeGovernedConnectionRequest");
  assert.equal(capabilities.functions.inbound_verify, "verifyGovernedInboundRequest");
  assert.ok(capabilities.authentication_modes.includes("oauth2_client_credentials"));
  assert.ok(capabilities.provider_signature_verifiers.includes("stripe"));
  assert.ok(capabilities.provider_signature_verifiers.includes("paypal"));
  assert.equal(capabilities.credentials.plaintext_in_execution_response, false);
});

test("tenant-targeted execution resolves tenant server-side and passes bounded request input to runtime", async (t) => {
  let captured = null;
  const app = await buildApp({
    services: {
      resolveConnectionTargetTenant: async (_db, tenantCode) => {
        assert.equal(tenantCode, "target-tenant");
        return { id: TARGET_TENANT_ID, code: "target-tenant", name: "Target Tenant" };
      },
      executeGovernedConnectionRequest: async (input) => {
        captured = input;
        return {
          ok: true,
          connection_code: "conn-3",
          status_code: 200,
          headers: { "content-type": "application/json" },
          body: { shared: true },
          attempts: 1,
        };
      },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/owner-admin/connections/tenants/target-tenant/conn-3/execute",
    headers: { "content-type": "application/json" },
    payload: {
      method: "POST",
      path: "/v1/share",
      query: { expand: "items" },
      headers: { "X-Request-Context": "test" },
      body: { value: 1 },
      body_encoding: "json",
      idempotency_key: "share-1",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(captured.tenantId, TARGET_TENANT_ID);
  assert.equal(captured.connectionCode, "conn-3");
  assert.equal(captured.requireEnabled, true);
  assert.deepEqual(captured.request.body, { value: 1 });
  assert.equal(captured.request.idempotency_key, "share-1");
  assert.equal(captured.request.tenant_id, undefined);
});

test("execution routes fail closed without TEST permission or CSRF", async (t) => {
  const denied = await buildApp({ permissionOk: false });
  const csrfDenied = await buildApp({ csrfOk: false });
  t.after(async () => {
    await denied.close();
    await csrfDenied.close();
  });

  const permissionResponse = await denied.inject({
    method: "POST",
    url: "/owner-admin/connections/conn-1/execute",
    payload: { method: "GET" },
  });
  assert.equal(permissionResponse.statusCode, 403);
  assert.equal(permissionResponse.json().error, "FORBIDDEN");

  const csrfResponse = await csrfDenied.inject({
    method: "POST",
    url: "/owner-admin/connections/conn-1/execute",
    payload: { method: "GET" },
  });
  assert.equal(csrfResponse.statusCode, 403);
  assert.equal(csrfResponse.json().error, "CSRF_INVALID");
});

test("execution request schema rejects browser tenant authority and unknown parameters", async (t) => {
  let called = false;
  const app = await buildApp({
    services: {
      executeGovernedConnectionRequest: async () => {
        called = true;
        return { ok: true, status_code: 200, attempts: 1 };
      },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/owner-admin/connections/conn-1/execute",
    payload: {
      method: "GET",
      tenant_id: TARGET_TENANT_ID,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(called, false);
});

test("request-plan can inspect a disabled profile without performing an external call", async (t) => {
  let planned = false;
  const app = await buildApp({
    services: {
      planGovernedConnectionRequest: async ({ request }) => {
        planned = true;
        return {
          connection_code: "conn-9",
          enabled: false,
          plan: {
            method: request.method,
            url: "https://api.example.com/v1/test",
            authentication: { mode: "oauth2_client_credentials", credential_value_exposed: false },
          },
        };
      },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/owner-admin/connections/conn-9/request-plan",
    payload: { method: "POST", path: "/v1/test", body: { test: true }, body_encoding: "json" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(planned, true);
  assert.equal(response.json().result.enabled, false);
  assert.equal(response.json().result.plan.authentication.credential_value_exposed, false);
});
