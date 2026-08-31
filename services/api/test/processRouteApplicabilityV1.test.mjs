import test from "node:test";
import assert from "node:assert/strict";

import {
  collectRouteApplicabilityParentAttrPaths,
  resolveProcessRouteApplicability
} from "../src/core/orchestration/processRouteApplicability.js";
import { resolveAndPersistProcessRoute } from "../src/core/orchestration/processRouteInitialization.js";

function candidate({
  bindingId,
  processDefId,
  processCode,
  sequence,
  expression,
  priority = 100
}) {
  return {
    binding_id: bindingId,
    binding_task_type: null,
    binding_priority: priority,
    binding_attrs: {
      route_v1: {
        step_code: processCode,
        sequence,
        ...(expression
          ? {
              applicability: {
                expression
              }
            }
          : {})
      }
    },
    process_def_id: processDefId,
    process_code: processCode,
    process_version: 1,
    declared_object_type: "sales_order"
  };
}

function projectionClient(row) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [row] };
    }
  };
}

test("bindings without applicability expressions default applicable and perform no parent projection", async () => {
  const candidates = [
    candidate({
      bindingId: "b-1",
      processDefId: "pd-1",
      processCode: "VALIDATE",
      sequence: 100
    })
  ];
  const client = projectionClient({});

  const result = await resolveProcessRouteApplicability(client, candidates, {
    tenantId: "tenant-1",
    serviceObjectId: "so-1",
    serviceObjectType: "sales_order"
  });

  assert.deepEqual(result.applicabilityByBindingId, { "b-1": true });
  assert.equal(result.projection_queries, 0);
  assert.equal(client.calls.length, 0);
  assert.equal(result.audit[0].source, "default_applicable");
});

test("governed applicability projects only referenced Service Object attrs", async () => {
  const candidates = [
    candidate({
      bindingId: "b-1",
      processDefId: "pd-1",
      processCode: "REVIEW",
      sequence: 100,
      expression: {
        op: "GTE",
        args: [{ ref: "$parent.attrs.total_amount" }, 1000]
      }
    })
  ];
  const client = projectionClient({
    id: "so-1",
    object_type: "sales_order",
    attr_0: 1250
  });

  const result = await resolveProcessRouteApplicability(client, candidates, {
    tenantId: "tenant-1",
    serviceObjectId: "so-1",
    serviceObjectType: "sales_order"
  });

  assert.equal(result.applicabilityByBindingId["b-1"], true);
  assert.deepEqual(result.parent_attr_paths, ["total_amount"]);
  assert.equal(result.projection_queries, 1);
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0].sql, /attrs\s*#>/);
  assert.doesNotMatch(client.calls[0].sql, /SELECT\s+[^\n]*attrs\s*(,|FROM)/i);
  assert.deepEqual(client.calls[0].params[2], ["total_amount"]);
  assert.equal(result.audit[0].source, "governed_reasoning");
  assert.match(result.audit[0].expression_digest, /^[0-9a-f]{64}$/);
});

test("multiple applicability expressions share one bounded parent projection query", async () => {
  const candidates = [
    candidate({
      bindingId: "b-1",
      processDefId: "pd-1",
      processCode: "VALUE_CHECK",
      sequence: 100,
      expression: { op: "GT", args: [{ ref: "$parent.attrs.total_amount" }, 500] }
    }),
    candidate({
      bindingId: "b-2",
      processDefId: "pd-2",
      processCode: "EXPEDITE",
      sequence: 200,
      expression: { op: "EQ", args: [{ ref: "$parent.attrs.priority_code" }, "urgent"] }
    })
  ];
  const client = projectionClient({
    id: "so-1",
    object_type: "sales_order",
    attr_0: "urgent",
    attr_1: 750
  });

  const result = await resolveProcessRouteApplicability(client, candidates, {
    tenantId: "tenant-1",
    serviceObjectId: "so-1",
    serviceObjectType: "sales_order"
  });

  assert.equal(client.calls.length, 1);
  assert.deepEqual(result.parent_attr_paths, ["priority_code", "total_amount"]);
  assert.equal(result.applicabilityByBindingId["b-1"], true);
  assert.equal(result.applicabilityByBindingId["b-2"], true);
});

test("applicability result must be boolean", async () => {
  const candidates = [
    candidate({
      bindingId: "b-1",
      processDefId: "pd-1",
      processCode: "INVALID",
      sequence: 100,
      expression: { ref: "$parent.attrs.total_amount" }
    })
  ];
  const client = projectionClient({
    id: "so-1",
    object_type: "sales_order",
    attr_0: 750
  });

  await assert.rejects(
    () => resolveProcessRouteApplicability(client, candidates, {
      tenantId: "tenant-1",
      serviceObjectId: "so-1",
      serviceObjectType: "sales_order"
    }),
    /ROUTE_APPLICABILITY_BOOLEAN_REQUIRED:b-1/
  );
});

test("applicability rejects non-governed reasoning roots", () => {
  const candidates = [
    candidate({
      bindingId: "b-1",
      processDefId: "pd-1",
      processCode: "INVALID",
      sequence: 100,
      expression: { op: "EQ", args: [{ ref: "$calc.hidden" }, true] }
    })
  ];

  assert.throws(
    () => collectRouteApplicabilityParentAttrPaths(candidates),
    /ROUTE_APPLICABILITY_REFERENCE_ROOT_NOT_ALLOWED:calc/
  );
});

test("applicability parent projection path count is bounded before database IO", async () => {
  const candidates = [
    candidate({
      bindingId: "b-1",
      processDefId: "pd-1",
      processCode: "CHECK_A",
      sequence: 100,
      expression: { op: "EQ", args: [{ ref: "$parent.attrs.a" }, 1] }
    }),
    candidate({
      bindingId: "b-2",
      processDefId: "pd-2",
      processCode: "CHECK_B",
      sequence: 200,
      expression: { op: "EQ", args: [{ ref: "$parent.attrs.b" }, 1] }
    })
  ];
  const client = projectionClient({});

  await assert.rejects(
    () => resolveProcessRouteApplicability(client, candidates, {
      tenantId: "tenant-1",
      serviceObjectId: "so-1",
      serviceObjectType: "sales_order",
      maxApplicabilityAttrPaths: 1
    }),
    /ROUTE_APPLICABILITY_ATTR_PATH_LIMIT_EXCEEDED/
  );
  assert.equal(client.calls.length, 0);
});

test("route initialization uses governed applicability when no external decision map is supplied", async () => {
  const candidates = [
    candidate({
      bindingId: "b-review",
      processDefId: "pd-review",
      processCode: "REVIEW",
      sequence: 100,
      expression: { op: "GTE", args: [{ ref: "$parent.attrs.total_amount" }, 1000] }
    }),
    candidate({
      bindingId: "b-normal",
      processDefId: "pd-normal",
      processCode: "NORMAL_FLOW",
      sequence: 200,
      expression: { op: "LT", args: [{ ref: "$parent.attrs.total_amount" }, 1000] }
    })
  ];
  const calls = [];
  const client = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const normalized = String(sql).replace(/\s+/g, " ").trim();

      if (normalized.includes("attrs #> $3::text[] AS route_snapshot")) {
        return { rowCount: 1, rows: [{ id: "so-1", route_snapshot: null }] };
      }
      if (normalized.includes("SELECT id, object_type FROM eip_core.service_object")) {
        return { rowCount: 1, rows: [{ id: "so-1", object_type: "sales_order" }] };
      }
      if (normalized.includes("FROM eip_core.process_binding pb")) {
        return { rowCount: candidates.length, rows: candidates };
      }
      if (normalized.includes("attrs #>") && normalized.includes("attr_0")) {
        return {
          rowCount: 1,
          rows: [{ id: "so-1", object_type: "sales_order", attr_0: 1500 }]
        };
      }
      if (normalized.includes("UPDATE eip_core.service_object")) {
        return { rowCount: 1, rows: [{ id: "so-1" }] };
      }
      throw new Error(`UNEXPECTED_SQL:${normalized}`);
    }
  };

  const result = await resolveAndPersistProcessRoute(client, {
    tenantId: "tenant-1",
    serviceObjectId: "so-1",
    createdAt: "2026-08-31T00:00:00.000Z"
  });

  assert.equal(result.applicability.source, "governed_reasoning");
  assert.equal(result.applicability.projection_queries, 1);
  assert.deepEqual(result.applicability.parent_attr_paths, ["total_amount"]);
  assert.equal(result.route_step_count, 1);
  assert.equal(result.snapshot.steps[0].process_def_id, "pd-review");
  assert.equal(result.snapshot.steps[0].step_code, "REVIEW");
  assert.match(result.applicability.audit_digest, /^[0-9a-f]{64}$/);
});
