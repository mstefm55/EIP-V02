import test from "node:test";
import assert from "node:assert/strict";

import { sha256Hex } from "../src/auth/crypto.js";
import authTransportHardeningPlugin, {
  addPartitionedAttribute,
  assertPartitionedCookieConfig,
} from "../src/plugins/authTransportHardening.js";

function createReply(initial = []) {
  const headers = new Map();
  if (initial.length) headers.set("set-cookie", initial);
  return {
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    header(name, value) {
      headers.set(String(name).toLowerCase(), value);
      return this;
    },
    headers,
  };
}

function createApp(overrides = {}) {
  const app = {
    config: {
      AUTH_COOKIE_PARTITIONED: true,
      AUTH_COOKIE_SECURE: true,
      AUTH_COOKIE_SAMESITE: "none",
      AUTH_COOKIE_DOMAIN: null,
      AUTH_CSRF_COOKIE_NAME: "csrf",
      AUTH_CSRF_PEPPER: "csrf-pepper",
      corsOrigin: ["https://frontend.example"],
      ...overrides,
    },
    issueAuthCookies(reply) {
      reply.header("Set-Cookie", [
        "sid=sid-value; Path=/; HttpOnly; Secure; SameSite=None",
        "csrf=csrf-value; Path=/; Secure; SameSite=None",
        "did=did-value; Path=/; HttpOnly; Secure; SameSite=None",
      ]);
      return reply;
    },
    clearAuthCookies(reply) {
      reply.header("Set-Cookie", [
        "sid=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0",
        "csrf=; Path=/; Secure; SameSite=None; Max-Age=0",
      ]);
      return reply;
    },
    async loadSession() {
      return null;
    },
    decorate(name, value) {
      this[name] = value;
    },
    addHook(name, handler) {
      this[`${name}Hook`] = handler;
    },
  };
  return app;
}

test("Partitioned is appended once to auth cookies", () => {
  assert.equal(addPartitionedAttribute("sid=x; Secure; SameSite=None"), "sid=x; Secure; SameSite=None; Partitioned");
  assert.equal(addPartitionedAttribute("sid=x; Secure; SameSite=None; Partitioned"), "sid=x; Secure; SameSite=None; Partitioned");
});

test("partitioned cookies fail closed on unsafe configuration", () => {
  assert.throws(
    () => assertPartitionedCookieConfig(createApp({ AUTH_COOKIE_SAMESITE: "lax" })),
    /AUTH_COOKIE_SAMESITE=none/
  );
  assert.throws(
    () => assertPartitionedCookieConfig(createApp({ AUTH_COOKIE_SECURE: false })),
    /AUTH_COOKIE_SECURE=true/
  );
  assert.throws(
    () => assertPartitionedCookieConfig(createApp({ AUTH_COOKIE_DOMAIN: ".example.com" })),
    /host-only cookies/
  );
});

test("auth cookie wrapper partitions issued and cleared cookies", async () => {
  const app = createApp();
  await authTransportHardeningPlugin(app);

  const issued = createReply();
  app.issueAuthCookies(issued, {});
  for (const cookie of issued.getHeader("set-cookie")) {
    assert.match(cookie, /Partitioned/);
  }

  const cleared = createReply();
  app.clearAuthCookies(cleared);
  for (const cookie of cleared.getHeader("set-cookie")) {
    assert.match(cookie, /Partitioned/);
  }
});

test("CSRF transport helper validates API-origin cookie against the session hash", async () => {
  const app = createApp();
  await authTransportHardeningPlugin(app);

  const session = {
    id: "11111111-1111-4111-8111-111111111111",
    tenant_id: "22222222-2222-4222-8222-222222222222",
    identity_id: "33333333-3333-4333-8333-333333333333",
    realm: "EIP",
  };
  const csrf = "csrf-token";
  session.csrf_secret_hash = sha256Hex([
    session.id,
    csrf,
    session.tenant_id,
    session.identity_id,
    session.realm,
    app.config.AUTH_CSRF_PEPPER,
  ].join(":"));

  const result = await app.readCsrfTokenForSession({
    session,
    headers: {
      origin: "https://frontend.example",
      cookie: `csrf=${csrf}`,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.csrf, csrf);
});

test("CSRF transport helper rejects untrusted origins", async () => {
  const app = createApp();
  await authTransportHardeningPlugin(app);
  const result = await app.readCsrfTokenForSession({
    headers: { origin: "https://attacker.example" },
  });
  assert.deepEqual(result, { ok: false, status: 403, error: "ORIGIN_FORBIDDEN" });
});
