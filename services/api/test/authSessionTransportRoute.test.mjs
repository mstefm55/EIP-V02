import test from "node:test";
import assert from "node:assert/strict";

import authSessionTransportRoutes from "../src/routes/auth_session_transport.js";

function createReply() {
  return {
    status: 200,
    headers: {},
    body: null,
    code(status) {
      this.status = status;
      return this;
    },
    header(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

test("csrf route returns only the bounded token projection and disables caching", async () => {
  let handler;
  const app = {
    get(path, fn) {
      assert.equal(path, "/auth/csrf");
      handler = fn;
    },
    async requireSession() {
      return { ok: true, session: { id: "session-id" } };
    },
    async readCsrfTokenForSession() {
      return { ok: true, csrf: "csrf-token", session: { secret: "must-not-leak" } };
    },
  };
  await authSessionTransportRoutes(app);

  const reply = createReply();
  await handler({}, reply);
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, { ok: true, csrf: "csrf-token" });
  assert.equal(reply.headers["cache-control"], "no-store, max-age=0");
  assert.equal(reply.headers.pragma, "no-cache");
});
