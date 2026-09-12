import assert from "node:assert/strict";
import test from "node:test";

import {
  processStudioLifecyclePreHandler,
  projectProcessStudioPayload,
  sanitizeDraftLifecycleInput,
} from "../src/plugins/processStudioLifecycleGuard.js";

function createReply() {
  return {
    status: null,
    payload: null,
    code(status) {
      this.status = status;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function session() {
  return { tenant_id: "tenant-1", identity_id: "identity-1", realm: "EIP" };
}

test("draft lifecycle input cannot publish or archive through generic save", () => {
  const publish = sanitizeDraftLifecycleInput({ is_published: true, attrs: {} });
  assert.equal(publish.ok, false);
  assert.equal(publish.error, "PROCESS_PUBLISH_ROUTE_REQUIRED");

  const archive = sanitizeDraftLifecycleInput({ attrs: { lifecycle_status: "archived" } });
  assert.equal(archive.ok, false);
  assert.equal(archive.error, "PROCESS_LIFECYCLE_ROUTE_REQUIRED");

  const draft = { is_published: false, attrs: { lifecycle_status: "draft", is_published: false, label: "x" } };
  const cleaned = sanitizeDraftLifecycleInput(draft);
  assert.equal(cleaned.ok, true);
  assert.deepEqual(cleaned.body.attrs, { label: "x" });
  assert.equal(Object.hasOwn(cleaned.body, "is_published"), false);
});

test("validation responses include structured Studio issues without removing canonical errors", () => {
  const payload = projectProcessStudioPayload(
    "/api/eip/process/defs/11111111-1111-4111-8111-111111111111/validate",
    "POST",
    { ok: true, valid: false, errors: ["INITIAL_NODE_REQUIRED", "MACRO_EFFECTS_REQUIRED:APPROVE"] }
  );

  assert.deepEqual(payload.errors, ["INITIAL_NODE_REQUIRED", "MACRO_EFFECTS_REQUIRED:APPROVE"]);
  assert.equal(payload.issues.length, 2);
  assert.equal(payload.issues[0].location, "graph");
  assert.equal(payload.issues[1].location, "macro:APPROVE");
});

test("workbench projection exposes canonical lifecycle alongside legacy attrs", () => {
  const payload = projectProcessStudioPayload(
    "/api/eip/process/workbench/catalog",
    "GET",
    {
      ok: true,
      items: [
        { id: "pd-draft", attrs: { lifecycle_status: "draft", is_published: false } },
        { id: "pd-published", attrs: { lifecycle_status: "published", is_published: true } },
      ],
    }
  );

  assert.equal(payload.items[0].lifecycle_status, "draft");
  assert.equal(payload.items[0].is_published, false);
  assert.equal(payload.items[1].lifecycle_status, "published");
  assert.equal(payload.items[1].is_published, true);
});

test("runtime start rejects an explicitly selected draft definition", async () => {
  const app = {
    requireSession: async () => ({ ok: true, session: session() }),
    db: {
      async query(sql) {
        assert.match(sql, /FROM eip_core\.process_def/);
        return {
          rowCount: 1,
          rows: [{
            id: "11111111-1111-4111-8111-111111111111",
            code: "approval",
            version: 2,
            is_active: true,
            attrs: { lifecycle_status: "draft", is_published: false },
          }],
        };
      },
    },
  };
  const req = {
    method: "POST",
    url: "/api/eip/process/instances",
    body: {
      service_object_id: "22222222-2222-4222-8222-222222222222",
      process_def_id: "11111111-1111-4111-8111-111111111111",
    },
  };
  const reply = createReply();

  await processStudioLifecyclePreHandler(app, req, reply);
  assert.equal(reply.status, 409);
  assert.equal(reply.payload.error, "PROCESS_DEF_NOT_PUBLISHED");
  assert.equal(reply.payload.lifecycle_status, "draft");
});

test("runtime code start pins the latest published version and skips a newer draft", async () => {
  const app = {
    requireSession: async () => ({ ok: true, session: session() }),
    db: {
      async query(sql) {
        assert.match(sql, /FROM eip_core\.process_def/);
        return {
          rowCount: 2,
          rows: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              code: "approval",
              version: 2,
              is_active: true,
              attrs: { lifecycle_status: "draft", is_published: false },
            },
            {
              id: "11111111-1111-4111-8111-111111111111",
              code: "approval",
              version: 1,
              is_active: true,
              attrs: { lifecycle_status: "published", is_published: true },
            },
          ],
        };
      },
    },
  };
  const req = {
    method: "POST",
    url: "/api/eip/process/instances",
    body: {
      service_object_id: "33333333-3333-4333-8333-333333333333",
      code: "approval",
    },
  };
  const reply = createReply();

  await processStudioLifecyclePreHandler(app, req, reply);
  assert.equal(reply.status, null);
  assert.equal(req.body.process_def_id, "11111111-1111-4111-8111-111111111111");
});

test("published Process Definitions reject content mutation but allow is_active toggle", async () => {
  const app = {
    requireSession: async () => ({ ok: true, session: session() }),
    db: {
      async query() {
        return {
          rowCount: 1,
          rows: [{
            id: "11111111-1111-4111-8111-111111111111",
            code: "approval",
            version: 1,
            is_active: true,
            attrs: { lifecycle_status: "published", is_published: true },
          }],
        };
      },
    },
  };

  const contentReq = {
    method: "PATCH",
    url: "/api/eip/process/defs/11111111-1111-4111-8111-111111111111",
    body: { name: "Changed" },
  };
  const contentReply = createReply();
  await processStudioLifecyclePreHandler(app, contentReq, contentReply);
  assert.equal(contentReply.status, 409);
  assert.equal(contentReply.payload.error, "PROCESS_DEF_PUBLISHED_IMMUTABLE");
  assert.equal(contentReply.payload.create_revision_required, true);

  const activeReq = {
    method: "PATCH",
    url: "/api/eip/process/defs/11111111-1111-4111-8111-111111111111",
    body: { is_active: false },
  };
  const activeReply = createReply();
  await processStudioLifecyclePreHandler(app, activeReq, activeReply);
  assert.equal(activeReply.status, null);
});
