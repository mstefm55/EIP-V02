import test from "node:test";
import assert from "node:assert/strict";

import {
  buildServiceObjectAttrsPatchExpression,
  normalizeServiceObjectAttrPatches,
  patchServiceObjectAttrs
} from "../src/core/serviceObjectJsonPatch.js";

test("bounded service-object patch normalizes SET and REMOVE operations", () => {
  const normalized = normalizeServiceObjectAttrPatches([
    {
      op: "SET",
      path: ["_eip_runtime", "process_route_v1", "steps", 2, "schedule_v1"],
      value: {
        planned_start_at: "2026-09-04T08:00:00.000Z",
        planned_finish_at: "2026-09-04T16:00:00.000Z",
        source_code: "CURRENT_SCHEDULE",
        revision: "42"
      }
    },
    {
      op: "REMOVE",
      path: ["temporary", "obsolete"]
    }
  ]);

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].op, "SET");
  assert.deepEqual(normalized[0].path, ["_eip_runtime", "process_route_v1", "steps", "2", "schedule_v1"]);
  assert.equal(normalized[1].op, "REMOVE");
});

test("patch SQL composes parameterized jsonb_set operations without top-level merge", () => {
  const built = buildServiceObjectAttrsPatchExpression([
    { op: "SET", path: ["a", "b"], value: { x: 1 } },
    { op: "SET", path: ["c"], value: 2 },
    { op: "REMOVE", path: ["d", "e"] }
  ], { startParam: 3 });

  assert.match(built.expression, /jsonb_set/);
  assert.match(built.expression, /#-/);
  assert.equal(built.expression.includes(" || "), false);
  assert.deepEqual(built.params[0], ["a", "b"]);
  assert.equal(built.params[1], JSON.stringify({ x: 1 }));
  assert.deepEqual(built.params[2], ["c"]);
  assert.equal(built.params[3], JSON.stringify(2));
  assert.deepEqual(built.params[4], ["d", "e"]);
});

test("patch paths reject prototype pollution segments", () => {
  assert.throws(
    () => normalizeServiceObjectAttrPatches([
      { op: "SET", path: ["attrs", "__proto__", "polluted"], value: true }
    ]),
    /SO_PATCH_PATH_SEGMENT_INVALID/
  );
});

test("patches are bounded before database IO", async () => {
  const client = {
    query() {
      throw new Error("DATABASE_IO_MUST_NOT_RUN");
    }
  };

  await assert.rejects(
    () => patchServiceObjectAttrs(client, {
      tenantId: "tenant-1",
      serviceObjectId: "so-1",
      maxPatches: 1,
      patches: [
        { path: ["a"], value: 1 },
        { path: ["b"], value: 2 }
      ]
    }),
    /SO_PATCH_LIMIT_EXCEEDED/
  );
});

test("patchServiceObjectAttrs scopes mutation by tenant and service object", async () => {
  const state = { sql: null, params: null };
  const client = {
    async query(sql, params) {
      state.sql = String(sql).replace(/\s+/g, " ").trim();
      state.params = params;
      return { rowCount: 1, rows: [{ id: "so-1" }] };
    }
  };

  const result = await patchServiceObjectAttrs(client, {
    tenantId: "tenant-1",
    serviceObjectId: "so-1",
    patches: [
      {
        path: ["_eip_runtime", "process_route_v1", "steps", "0", "schedule_v1"],
        value: {
          planned_start_at: "2026-09-04T08:00:00.000Z"
        }
      }
    ]
  });

  assert.match(state.sql, /WHERE tenant_id=\$1 AND id=\$2/);
  assert.match(state.sql, /jsonb_set/);
  assert.equal(state.sql.includes(" || "), false);
  assert.equal(state.params[0], "tenant-1");
  assert.equal(state.params[1], "so-1");
  assert.deepEqual(state.params[2], ["_eip_runtime", "process_route_v1", "steps", "0", "schedule_v1"]);
  assert.deepEqual(JSON.parse(state.params[3]), {
    planned_start_at: "2026-09-04T08:00:00.000Z"
  });
  assert.equal(result.patch_count, 1);
});

test("missing service object fails closed", async () => {
  const client = {
    async query() {
      return { rowCount: 0, rows: [] };
    }
  };

  await assert.rejects(
    () => patchServiceObjectAttrs(client, {
      tenantId: "tenant-1",
      serviceObjectId: "so-missing",
      patches: [{ path: ["x"], value: 1 }]
    }),
    /SERVICE_OBJECT_NOT_FOUND/
  );
});
