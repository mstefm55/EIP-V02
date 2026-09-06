import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import authOrganisationRoutes from "../src/routes/auth_organisations.js";

async function buildTestApp({ origin = "https://frontend.example", rows = [] } = {}) {
  const app = Fastify({ logger: false });
  app.decorate("config", { corsOrigin: [origin] });
  app.decorate("db", {
    async query() {
      return { rows, rowCount: rows.length };
    },
  });
  app.decorate("loadPasswordCredential", async () => null);
  await app.register(authOrganisationRoutes, { prefix: "/api/eip" });
  await app.ready();
  return app;
}

test("organisation lookup resolves active tenant metadata and canonical identity login", async () => {
  const app = await buildTestApp({
    rows: [
      {
        tenant_id: "11111111-1111-4111-8111-111111111111",
        identity_id: "22222222-2222-4222-8222-222222222222",
        identity_login: "v2.admin",
        tenant_code: "v2seed",
        tenant_name: "V2 Seed Tenant",
      },
    ],
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/eip/auth/organisations",
    headers: { origin: "https://frontend.example" },
    payload: { email: "admin@example.com" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    organisations: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        code: "v2seed",
        name: "V2 Seed Tenant",
        identity_login: "v2.admin",
      },
    ],
  });

  await app.close();
});

test("organisation lookup rejects an untrusted browser origin", async () => {
  const app = await buildTestApp();

  const response = await app.inject({
    method: "POST",
    url: "/api/eip/auth/organisations",
    headers: { origin: "https://evil.example" },
    payload: { email: "admin@example.com" },
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { ok: false, error: "ORIGIN_FORBIDDEN" });

  await app.close();
});
