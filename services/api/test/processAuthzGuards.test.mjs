import test from "node:test";
import assert from "node:assert/strict";
import { requirePerm, resolveTenantScope } from "../src/routes/process/core_process.js";

function createReplyRecorder() {
  return {
    statusCode: null,
    payload: null,
    code(status) {
      this.statusCode = status;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function buildSchemaOkRow() {
  return {
    t0: "eip_core.dropdown_list",
    t1: "eip_core.dropdown_value",
    t2: "eip_core.process_def",
    t3: "eip_core.process_binding",
    t4: "eip_core.process_instance",
    t5: "eip_core.process_task_template",
    t6: "eip_core.service_object",
    t7: "eip_core.task",
  };
}

test("resolveTenantScope keeps session tenant and rejects cross-tenant target", async () => {
  const session = { tenant_id: "tenant-1" };
  const sameTenant = await resolveTenantScope({}, session, "tenant-1");
  const sessionTenant = await resolveTenantScope({}, session, null);
  const crossTenant = await resolveTenantScope({}, session, "tenant-2");

  assert.deepEqual(sameTenant, { ok: true, tenantId: "tenant-1" });
  assert.deepEqual(sessionTenant, { ok: true, tenantId: "tenant-1" });
  assert.deepEqual(crossTenant, { ok: false, error: "TENANT_ACCESS_REQUIRED" });
});

test("requirePerm denies when central permission check fails", async () => {
  const reply = createReplyRecorder();
  const app = {
    requirePermission: async () => ({
      ok: false,
      status: 403,
      error: "PERMISSION_REQUIRED",
      required_permissions: ["PROCESS_DEF_READ"],
    }),
  };

  const session = await requirePerm(app, {}, reply, ["PROCESS_DEF_READ"]);
  assert.equal(session, null);
  assert.equal(reply.statusCode, 403);
  assert.deepEqual(reply.payload, {
    ok: false,
    error: "PERMISSION_REQUIRED",
    required_permissions: ["PROCESS_DEF_READ"],
  });
});

test("requirePerm denies when csrf is missing even after permission allow", async () => {
  const reply = createReplyRecorder();
  const app = {
    requirePermission: async () => ({ ok: true, session: { tenant_id: "tenant-1" } }),
    requireCsrf: async () => ({ ok: false, status: 403, error: "CSRF_MISSING" }),
  };

  const session = await requirePerm(app, {}, reply, ["PROCESS_DEF_READ"]);
  assert.equal(session, null);
  assert.equal(reply.statusCode, 403);
  assert.deepEqual(reply.payload, { ok: false, error: "CSRF_MISSING" });
});

test("requirePerm denies when process schema is unavailable", async () => {
  const reply = createReplyRecorder();
  const app = {
    requirePermission: async () => ({ ok: true, session: { tenant_id: "tenant-1" } }),
    requireCsrf: async () => ({ ok: true }),
    db: {
      query: async () => ({
        rows: [
          {
            t0: "eip_core.dropdown_list",
            t1: null,
            t2: "eip_core.process_def",
            t3: "eip_core.process_binding",
            t4: "eip_core.process_instance",
            t5: "eip_core.process_task_template",
            t6: "eip_core.service_object",
            t7: "eip_core.task",
          },
        ],
      }),
    },
  };

  const session = await requirePerm(app, {}, reply, ["PROCESS_DEF_READ"]);
  assert.equal(session, null);
  assert.equal(reply.statusCode, 503);
  assert.equal(reply.payload.error, "PROCESS_SCHEMA_UNAVAILABLE");
  assert.ok(Array.isArray(reply.payload.missing));
});

test("requirePerm returns session when authz, csrf, and schema checks pass", async () => {
  const reply = createReplyRecorder();
  const expectedSession = { tenant_id: "tenant-1", identity_id: "identity-1" };
  const app = {
    requirePermission: async () => ({ ok: true, session: expectedSession }),
    requireCsrf: async () => ({ ok: true }),
    db: {
      query: async () => ({
        rows: [buildSchemaOkRow()],
      }),
    },
  };

  const session = await requirePerm(app, {}, reply, ["PROCESS_DEF_READ"]);
  assert.deepEqual(session, expectedSession);
  assert.equal(reply.statusCode, null);
});
