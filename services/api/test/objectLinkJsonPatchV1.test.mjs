import test from "node:test";
import assert from "node:assert/strict";

import {
  buildObjectLinkAttrsPatchExpression,
  normalizeObjectLinkAttrPatches,
  patchObjectLinkAttrs
} from "../src/core/objectLinkJsonPatch.js";

test("bounded link patch normalizes SET and REMOVE operations", () => {
  const normalized = normalizeObjectLinkAttrPatches([
    { op: "SET", path: ["allocation", "quantity"], value: 80 },
    { op: "REMOVE", path: ["temporary", "candidate"] }
  ]);

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].op, "SET");
  assert.deepEqual(normalized[0].path, ["allocation", "quantity"]);
  assert.equal(normalized[1].op, "REMOVE");
});

test("link patch SQL composes parameterized jsonb_set operations", () => {
  const built = buildObjectLinkAttrsPatchExpression([
    { op: "SET", path: ["allocation", "quantity"], value: 60 },
    { op: "REMOVE", path: ["temporary"] }
  ], { startParam: 7 });

  assert.match(built.expression, /jsonb_set/);
  assert.match(built.expression, /#-/);
  assert.equal(built.expression.includes(" || "), false);
  assert.deepEqual(built.params[0], ["allocation", "quantity"]);
  assert.equal(built.params[1], JSON.stringify(60));
  assert.deepEqual(built.params[2], ["temporary"]);
});

test("link patch paths reject prototype pollution segments", () => {
  assert.throws(
    () => normalizeObjectLinkAttrPatches([
      { op: "SET", path: ["allocation", "__proto__", "polluted"], value: true }
    ]),
    /LINK_PATCH_PATH_SEGMENT_INVALID/
  );
});

test("link patches are bounded before database IO", async () => {
  const client = {
    query() {
      throw new Error("DATABASE_IO_MUST_NOT_RUN");
    }
  };

  await assert.rejects(
    () => patchObjectLinkAttrs(client, {
      tenantId: "tenant-1",
      srcKind: "service_object",
      srcId: "so-demand",
      dstKind: "service_object",
      dstId: "so-supply",
      relationType: "ALLOCATED_FROM",
      maxPatches: 1,
      patches: [
        { path: ["quantity"], value: 80 },
        { path: ["consumed"], value: 20 }
      ]
    }),
    /LINK_PATCH_LIMIT_EXCEEDED/
  );
});

test("patchObjectLinkAttrs scopes mutation by tenant and complete link identity", async () => {
  const state = { sql: null, params: null };
  const client = {
    async query(sql, params) {
      state.sql = String(sql).replace(/\s+/g, " ").trim();
      state.params = params;
      return {
        rowCount: 1,
        rows: [{
          src_kind: "service_object",
          src_id: "so-demand",
          dst_kind: "service_object",
          dst_id: "so-supply",
          relation_type: "ALLOCATED_FROM"
        }]
      };
    }
  };

  const result = await patchObjectLinkAttrs(client, {
    tenantId: "tenant-1",
    srcKind: "service_object",
    srcId: "so-demand",
    dstKind: "service_object",
    dstId: "so-supply",
    relationType: "ALLOCATED_FROM",
    patches: [
      { path: ["allocation", "quantity"], value: 60 }
    ]
  });

  assert.match(state.sql, /WHERE tenant_id=\$1/);
  assert.match(state.sql, /src_kind=\$2/);
  assert.match(state.sql, /src_id=\$3/);
  assert.match(state.sql, /dst_kind=\$4/);
  assert.match(state.sql, /dst_id=\$5/);
  assert.match(state.sql, /relation_type=\$6/);
  assert.match(state.sql, /jsonb_set/);
  assert.equal(state.params[0], "tenant-1");
  assert.equal(state.params[1], "service_object");
  assert.equal(state.params[2], "so-demand");
  assert.equal(state.params[3], "service_object");
  assert.equal(state.params[4], "so-supply");
  assert.equal(state.params[5], "ALLOCATED_FROM");
  assert.deepEqual(state.params[6], ["allocation", "quantity"]);
  assert.equal(JSON.parse(state.params[7]), 60);
  assert.equal(result.patch_count, 1);
});

test("missing link fails closed", async () => {
  const client = {
    async query() {
      return { rowCount: 0, rows: [] };
    }
  };

  await assert.rejects(
    () => patchObjectLinkAttrs(client, {
      tenantId: "tenant-1",
      srcKind: "service_object",
      srcId: "missing-src",
      dstKind: "service_object",
      dstId: "missing-dst",
      relationType: "ALLOCATED_FROM",
      patches: [{ path: ["quantity"], value: 1 }]
    }),
    /LINK_NOT_FOUND/
  );
});
