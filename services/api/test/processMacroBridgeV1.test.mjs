import test from "node:test";
import assert from "node:assert/strict";

import {
  executeProcessMacroReasoning,
  loadMacroParentProjection,
  resolveCalculatedRef
} from "../src/core/reasoning/processMacroBridge.js";

function fakeProjectionClient(row) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [row] };
    }
  };
}

test("parent projection fetches only referenced JSONB paths", async () => {
  const client = fakeProjectionClient({
    present_0: true,
    value_0: 500,
    present_1: true,
    value_1: 10000
  });

  const macro = {
    reasoning: [
      {
        as: "hours",
        expression: {
          op: "DIVIDE",
          args: [
            { ref: "$parent.attrs.quantity" },
            { ref: "$parent.attrs.production.rate" }
          ]
        }
      }
    ]
  };

  const projection = await loadMacroParentProjection(client, {
    tenantId: "tenant-1",
    serviceObject: { id: "so-1", object_type: "order", status: "new" },
    macro
  });

  assert.deepEqual(projection.paths, ["production.rate", "quantity"]);
  assert.deepEqual(projection.parent.attrs, {
    production: { rate: 500 },
    quantity: 10000
  });
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0].sql, /attrs #>/);
  assert.doesNotMatch(client.calls[0].sql, /SELECT\s+attrs\s*(,|FROM)/i);
  assert.deepEqual(client.calls[0].params, [
    "tenant-1",
    "so-1",
    ["production", "rate"],
    ["quantity"]
  ]);
});

test("macro with no parent attrs performs no projection query", async () => {
  const client = fakeProjectionClient({});
  const result = await executeProcessMacroReasoning(client, {
    tenantId: "tenant-1",
    serviceObject: { id: "so-1", object_type: "order" },
    macro: {
      reasoning: [
        {
          as: "double",
          expression: { op: "MULTIPLY", args: [{ ref: "$input.value" }, 2] }
        }
      ]
    },
    input: { value: 6 }
  });

  assert.equal(result.calc.double, 12);
  assert.equal(result.projection_queries, 0);
  assert.equal(client.calls.length, 0);
});

test("bridge executes chained reasoning from bounded parent projection", async () => {
  const client = fakeProjectionClient({ present_0: true, value_0: 10000 });
  const macro = {
    reasoning: [
      {
        as: "required_hours",
        expression: {
          op: "DIVIDE",
          args: [{ ref: "$parent.attrs.quantity" }, { ref: "$input.rate" }]
        }
      },
      {
        as: "required_minutes",
        expression: {
          op: "MULTIPLY",
          args: [{ ref: "$context.calc.required_hours" }, 60]
        }
      }
    ]
  };

  const result = await executeProcessMacroReasoning(client, {
    tenantId: "tenant-1",
    serviceObject: { id: "so-1", status: "new" },
    macro,
    input: { rate: 500 }
  });

  assert.equal(result.calc.required_hours, 20);
  assert.equal(result.calc.required_minutes, 1200);
  assert.equal(result.audit.length, 2);
  assert.equal(typeof result.calc_digest, "string");
  assert.deepEqual(result.parent_attr_paths, ["quantity"]);
});

test("missing parent attr remains absent rather than materializing a fake value", async () => {
  const client = fakeProjectionClient({ present_0: false, value_0: null });
  const projection = await loadMacroParentProjection(client, {
    tenantId: "tenant-1",
    serviceObject: { id: "so-1" },
    macro: {
      reasoning: [{ as: "x", expression: { ref: "$parent.attrs.optional.value" } }]
    }
  });

  assert.deepEqual(projection.parent.attrs, {});
});

test("calculated references resolve nested values without broad dynamic evaluation", () => {
  const calc = {
    schedule: {
      required_minutes: 1200,
      selected: { workstation_id: "ws-2" }
    }
  };

  assert.equal(resolveCalculatedRef("$calc.schedule.required_minutes", calc), 1200);
  assert.equal(resolveCalculatedRef("$calc.schedule.selected.workstation_id", calc), "ws-2");
  assert.deepEqual(resolveCalculatedRef("$calc", calc), calc);
  assert.equal(resolveCalculatedRef("$payload.quantity", calc), "$payload.quantity");
});

test("parent attr projection is bounded by path-count limit", async () => {
  const client = fakeProjectionClient({});
  const macro = {
    reasoning: [
      {
        as: "x",
        expression: {
          op: "ADD",
          args: [
            { ref: "$parent.attrs.a" },
            { ref: "$parent.attrs.b" }
          ]
        }
      }
    ]
  };

  await assert.rejects(
    () => loadMacroParentProjection(client, {
      tenantId: "tenant-1",
      serviceObject: { id: "so-1" },
      macro,
      maxParentAttrPaths: 1
    }),
    /MACRO_PARENT_ATTR_PATH_LIMIT_EXCEEDED/
  );
  assert.equal(client.calls.length, 0);
});

test("macro without reasoning does nothing and does not query", async () => {
  const client = fakeProjectionClient({});
  const result = await executeProcessMacroReasoning(client, {
    tenantId: "tenant-1",
    serviceObject: { id: "so-1" },
    macro: { effects: [{ type: "SO_UPDATE" }] }
  });

  assert.equal(result.executed, false);
  assert.deepEqual(result.calc, {});
  assert.equal(client.calls.length, 0);
});
