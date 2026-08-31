import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProcessRouteFromCandidates,
  initializeAndStartProcessRoute,
  initializeProcessRoute,
  loadProcessRouteCandidates,
  resolveAndPersistProcessRoute
} from "../src/core/orchestration/processRouteInitialization.js";
import { buildProcessRouteSnapshot } from "../src/core/orchestration/processRoutePlanner.js";

function candidate(overrides = {}) {
  return {
    binding_id: "binding-1",
    binding_task_type: null,
    binding_priority: 100,
    binding_attrs: { route_v1: { step_code: "VALIDATE", sequence: 100 } },
    process_def_id: "pd-validate",
    process_code: "VALIDATE_ORDER",
    process_version: 2,
    declared_object_type: "sales_order",
    ...overrides
  };
}

function initializationClient({
  serviceObjectType = "sales_order",
  candidates = [candidate()],
  existingSnapshot = null
} = {}) {
  const calls = [];
  let routeSnapshot = existingSnapshot;

  return {
    calls,
    get routeSnapshot() {
      return routeSnapshot;
    },
    async query(sql, params) {
      calls.push({ sql, params });
      const normalized = String(sql).replace(/\s+/g, " ").trim();

      if (normalized.includes("attrs #>") && normalized.includes("FROM eip_core.service_object")) {
        return { rowCount: 1, rows: [{ id: "so-1", route_snapshot: routeSnapshot }] };
      }

      if (normalized.includes("SELECT id, object_type") && normalized.includes("FROM eip_core.service_object")) {
        return { rowCount: 1, rows: [{ id: "so-1", object_type: serviceObjectType }] };
      }

      if (normalized.includes("FROM eip_core.process_binding pb")) {
        return { rowCount: candidates.length, rows: candidates };
      }

      if (normalized.includes("UPDATE eip_core.service_object")) {
        routeSnapshot = JSON.parse(params[2]);
        return { rowCount: 1, rows: [{ id: "so-1" }] };
      }

      throw new Error(`UNEXPECTED_SQL:${normalized}`);
    }
  };
}

test("candidate resolver uses bounded relational filtering and does not load an unbounded binding set", async () => {
  const client = initializationClient({ candidates: [candidate()] });

  const rows = await loadProcessRouteCandidates(client, {
    tenantId: "tenant-1",
    serviceObjectType: "sales_order",
    maxCandidates: 5
  });

  assert.equal(rows.length, 1);
  assert.equal(client.calls.length, 1);
  const call = client.calls[0];
  assert.match(call.sql, /pb\.tenant_id=\$1/);
  assert.match(call.sql, /pb\.service_object_type=\$2/);
  assert.match(call.sql, /pb\.is_active=true/);
  assert.match(call.sql, /pd\.is_active=true/);
  assert.match(call.sql, /pb\.task_type IS NULL/);
  assert.match(call.sql, /LIMIT \$4/);
  assert.equal(call.params[3], 6);
});

test("binding priority is not silently used as business route sequence", () => {
  const snapshot = buildProcessRouteFromCandidates([
    candidate({
      binding_id: "binding-plan",
      binding_priority: 1,
      binding_attrs: { route_v1: { step_code: "PLAN", sequence: 200 } },
      process_def_id: "pd-plan",
      process_code: "PLAN_WORK",
      process_version: 7
    }),
    candidate({
      binding_id: "binding-validate",
      binding_priority: 999,
      binding_attrs: { route_v1: { step_code: "VALIDATE", sequence: 100 } },
      process_def_id: "pd-validate",
      process_code: "VALIDATE_ORDER",
      process_version: 2
    })
  ], {
    createdAt: "2026-08-31T00:00:00.000Z"
  });

  assert.deepEqual(snapshot.steps.map((step) => step.step_code), ["VALIDATE", "PLAN"]);
  assert.deepEqual(snapshot.steps.map((step) => step.process_version), [2, 7]);
  assert.equal(snapshot.steps[0].attrs.binding_id, "binding-validate");
  assert.equal(snapshot.steps[1].attrs.binding_priority, 1);
});

test("multi-step route fails closed when explicit route sequence is missing", () => {
  assert.throws(
    () => buildProcessRouteFromCandidates([
      candidate({ binding_id: "binding-1", binding_attrs: { route_v1: { step_code: "A" } } }),
      candidate({
        binding_id: "binding-2",
        binding_attrs: { route_v1: { step_code: "B", sequence: 200 } },
        process_def_id: "pd-b",
        process_code: "PROCESS_B"
      })
    ]),
    /ROUTE_SEQUENCE_REQUIRED:binding-1/
  );
});

test("resolved applicability filters candidates without adding a route condition language", () => {
  const snapshot = buildProcessRouteFromCandidates([
    candidate({ binding_id: "binding-1" }),
    candidate({
      binding_id: "binding-2",
      binding_attrs: { route_v1: { step_code: "PLAN" } },
      process_def_id: "pd-plan",
      process_code: "PLAN_WORK",
      process_version: 7
    })
  ], {
    applicabilityByBindingId: {
      "binding-1": false,
      "binding-2": true
    }
  });

  assert.equal(snapshot.steps.length, 1);
  assert.equal(snapshot.steps[0].step_code, "PLAN");
  assert.equal(snapshot.steps[0].sequence, 100);

  assert.throws(
    () => buildProcessRouteFromCandidates([candidate()], {
      applicabilityByBindingId: { "binding-1": "yes" }
    }),
    /ROUTE_APPLICABILITY_INVALID:binding-1/
  );
});

test("candidate resolver fails closed when the bounded set overflows", async () => {
  const rows = Array.from({ length: 4 }, (_, index) => candidate({ binding_id: `binding-${index}` }));
  const client = initializationClient({ candidates: rows });

  await assert.rejects(
    () => loadProcessRouteCandidates(client, {
      tenantId: "tenant-1",
      serviceObjectType: "sales_order",
      maxCandidates: 3
    }),
    /ROUTE_CANDIDATE_LIMIT_EXCEEDED/
  );
});

test("route initialization refuses to overwrite an existing durable route by default", async () => {
  const existing = buildProcessRouteSnapshot([
    {
      step_code: "EXISTING",
      sequence: 100,
      process_def_id: "pd-existing",
      process_code: "EXISTING_PROCESS",
      process_version: 1
    }
  ]);
  const client = initializationClient({ existingSnapshot: existing });

  await assert.rejects(
    () => resolveAndPersistProcessRoute(client, {
      tenantId: "tenant-1",
      serviceObjectId: "so-1"
    }),
    /ROUTE_SNAPSHOT_ALREADY_EXISTS/
  );

  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0].sql, /FOR UPDATE/);
});

test("automatic initialization resolves and saves the pinned route without starting processing", async () => {
  const client = initializationClient({
    candidates: [
      candidate({
        binding_id: "binding-plan",
        binding_priority: 1,
        binding_attrs: { route_v1: { step_code: "PLAN", sequence: 200 } },
        process_def_id: "pd-plan",
        process_code: "PLAN_WORK",
        process_version: 7
      }),
      candidate({
        binding_id: "binding-validate",
        binding_priority: 100,
        binding_attrs: { route_v1: { step_code: "VALIDATE", sequence: 100 } },
        process_def_id: "pd-validate",
        process_code: "VALIDATE_ORDER",
        process_version: 2
      })
    ]
  });

  const result = await initializeProcessRoute(client, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    createdAt: "2026-08-31T00:00:00.000Z"
  });

  assert.equal(result.initialization.candidate_count, 2);
  assert.equal(result.initialization.route_step_count, 2);
  assert.equal(result.snapshot.steps[0].step_code, "VALIDATE");
  assert.equal(result.snapshot.steps[0].state, "PENDING");
  assert.equal(result.snapshot.steps[0].process_instance_id, undefined);
  assert.equal(result.snapshot.steps[1].state, "PENDING");
  assert.equal(result.action.type, "ROUTE_INITIALIZED");
  assert.equal(client.routeSnapshot.steps[0].process_instance_id, undefined);

  const routeWrites = client.calls.filter((entry) =>
    String(entry.sql).includes("UPDATE eip_core.service_object")
  );
  assert.equal(routeWrites.length, 1);
});

test("legacy initializeAndStart wrapper is compatibility-only and no longer starts a Process Instance", async () => {
  const client = initializationClient();
  let starts = 0;

  const result = await initializeAndStartProcessRoute(client, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    startProcess: async () => {
      starts += 1;
      throw new Error("SHOULD_NOT_START");
    }
  });

  assert.equal(result.action.type, "ROUTE_INITIALIZED");
  assert.equal(result.snapshot.steps[0].state, "PENDING");
  assert.equal(starts, 0);
});
