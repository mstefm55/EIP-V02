import test from "node:test";
import assert from "node:assert/strict";

import { buildProcessRouteSnapshot } from "../src/core/orchestration/processRoutePlanner.js";
import {
  digestProcessRouteSnapshot,
  initializeProcessRouteSnapshot,
  loadProcessRouteSnapshot,
  runPersistedProcessRouteLifecycleTick
} from "../src/core/orchestration/processRoutePersistence.js";
import {
  bindRouteStepInstance,
  coordinateProcessRoute
} from "../src/core/orchestration/processRouteCoordinator.js";

function route() {
  return buildProcessRouteSnapshot(
    [
      {
        step_code: "VALIDATE",
        sequence: 100,
        process_def_id: "pd-validate",
        process_code: "VALIDATE_ORDER",
        process_version: 2
      },
      {
        step_code: "PLAN",
        sequence: 200,
        process_def_id: "pd-plan",
        process_code: "PLAN_WORK",
        process_version: 7
      }
    ],
    {
      createdAt: "2026-08-31T00:00:00.000Z",
      sourceCode: "MTO_JOB_SHOP",
      sourceVersion: 3
    }
  );
}

function persistenceClient({ snapshot = null, processRow = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const normalized = String(sql).replace(/\s+/g, " ").trim();

      if (normalized.includes("FROM eip_core.service_object")) {
        return {
          rowCount: 1,
          rows: [{ id: "so-1", route_snapshot: snapshot }]
        };
      }

      if (normalized.includes("FROM eip_core.process_instance")) {
        if (!processRow) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [processRow] };
      }

      if (normalized.includes("UPDATE eip_core.service_object")) {
        return { rowCount: 1, rows: [{ id: "so-1" }] };
      }

      throw new Error(`UNEXPECTED_SQL:${normalized}`);
    }
  };
}

test("route persistence reads only the reserved JSONB projection", async () => {
  const snapshot = route();
  const client = persistenceClient({ snapshot });

  const loaded = await loadProcessRouteSnapshot(client, {
    tenantId: "tenant-1",
    serviceObjectId: "so-1"
  });

  assert.deepEqual(loaded, snapshot);
  assert.equal(client.calls.length, 1);
  const sql = client.calls[0].sql;
  assert.match(sql, /attrs\s*#>/);
  assert.doesNotMatch(sql, /SELECT\s+\*/i);
  assert.deepEqual(client.calls[0].params[2], ["_eip_runtime", "process_route_v1"]);
});

test("route snapshot digest is stable", () => {
  const snapshot = route();
  assert.equal(digestProcessRouteSnapshot(snapshot), digestProcessRouteSnapshot(snapshot));
  assert.match(digestProcessRouteSnapshot(snapshot), /^[0-9a-f]{64}$/);
});

test("route initialization fails closed when a route already exists", async () => {
  const snapshot = route();
  const client = persistenceClient({ snapshot });

  await assert.rejects(
    () => initializeProcessRouteSnapshot(client, snapshot, {
      tenantId: "tenant-1",
      serviceObjectId: "so-1"
    }),
    /ROUTE_SNAPSHOT_ALREADY_EXISTS/
  );

  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0].sql, /FOR UPDATE/);
});

test("route initialization writes only reserved runtime namespace when absent", async () => {
  const snapshot = route();
  const client = persistenceClient({ snapshot: null });

  const result = await initializeProcessRouteSnapshot(client, snapshot, {
    tenantId: "tenant-1",
    serviceObjectId: "so-1"
  });

  assert.match(result.digest, /^[0-9a-f]{64}$/);
  assert.ok(result.bytes > 0);
  assert.equal(client.calls.length, 2);
  assert.match(client.calls[0].sql, /FOR UPDATE/);
  assert.match(client.calls[1].sql, /jsonb_set/);
  assert.match(client.calls[1].sql, /_eip_runtime/);
  assert.match(client.calls[1].sql, /process_route_v1/);
});

test("route persistence preserves an accepted per-step schedule projection", async () => {
  const snapshot = route();
  snapshot.steps[0].schedule_v1 = {
    planned_start_at: "2026-08-31T08:00:00.000Z",
    planned_finish_at: "2026-08-31T09:00:00.000Z",
    source_code: "CURRENT_SCHEDULE",
    revision: "4"
  };
  const client = persistenceClient({ snapshot: null });

  await initializeProcessRouteSnapshot(client, snapshot, {
    tenantId: "tenant-1",
    serviceObjectId: "so-1"
  });

  const written = JSON.parse(client.calls[1].params[2]);
  assert.deepEqual(written.steps[0].schedule_v1, snapshot.steps[0].schedule_v1);
});

test("persisted lifecycle tick completes current process and leaves next unscheduled route step pending", async () => {
  const first = coordinateProcessRoute(route(), { serviceObjectId: "so-1" });
  const bound = bindRouteStepInstance(first.snapshot, "VALIDATE", "pi-1");
  const client = persistenceClient({
    snapshot: bound,
    processRow: {
      id: "pi-1",
      service_object_id: "so-1",
      process_def_id: "pd-validate",
      status: "completed",
      ended_at: "2026-08-31T00:30:00.000Z"
    }
  });
  let starts = 0;

  const result = await runPersistedProcessRouteLifecycleTick(client, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T00:30:00.000Z",
    startProcess: async () => {
      starts += 1;
      throw new Error("SHOULD_NOT_START");
    }
  });

  assert.equal(result.snapshot.steps[0].state, "COMPLETED");
  assert.equal(result.snapshot.steps[0].completed_at, "2026-08-31T00:30:00.000Z");
  assert.equal(result.snapshot.steps[1].state, "PENDING");
  assert.equal(result.action.type, "WAIT_SCHEDULE");
  assert.equal(starts, 0);
  assert.equal(
    result.persistence.storage,
    "service_object.attrs._eip_runtime.process_route_v1"
  );
  assert.match(result.persistence.route_digest, /^[0-9a-f]{64}$/);

  const serviceReads = client.calls.filter((entry) =>
    String(entry.sql).includes("FROM eip_core.service_object")
  );
  const serviceWrites = client.calls.filter((entry) =>
    String(entry.sql).includes("UPDATE eip_core.service_object")
  );
  assert.equal(serviceReads.length, 1);
  assert.match(serviceReads[0].sql, /FOR UPDATE/);
  assert.equal(serviceWrites.length, 1);
});

test("oversized route snapshot fails before database IO", async () => {
  const snapshot = route();
  snapshot.steps[0].attrs = { payload: "x".repeat(5000) };
  const client = persistenceClient({ snapshot: null });

  await assert.rejects(
    () => initializeProcessRouteSnapshot(client, snapshot, {
      tenantId: "tenant-1",
      serviceObjectId: "so-1",
      maxRouteBytes: 1024
    }),
    /ROUTE_SNAPSHOT_SIZE_LIMIT_EXCEEDED/
  );
});
