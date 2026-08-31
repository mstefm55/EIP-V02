import test from "node:test";
import assert from "node:assert/strict";

import { buildProcessRouteSnapshot } from "../src/core/orchestration/processRoutePlanner.js";
import {
  bindRouteStepInstance,
  coordinateProcessRoute
} from "../src/core/orchestration/processRouteCoordinator.js";
import {
  readProcessInstanceOutcome,
  runProcessRouteLifecycleTick
} from "../src/core/orchestration/processRouteLifecycleRuntime.js";

function route(entries = null) {
  return buildProcessRouteSnapshot(
    entries || [
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

function activeBoundRoute(snapshot = route(), stepCode = "VALIDATE", processInstanceId = "pi-1") {
  const coordinated = coordinateProcessRoute(snapshot, { serviceObjectId: "so-1" });
  return bindRouteStepInstance(coordinated.snapshot, stepCode, processInstanceId);
}

function processClient(row) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return row
        ? { rowCount: 1, rows: [row] }
        : { rowCount: 0, rows: [] };
    }
  };
}

test("active bound Process Instance remains waiting without starting another process", async () => {
  const snapshot = activeBoundRoute();
  const client = processClient({
    id: "pi-1",
    service_object_id: "so-1",
    process_def_id: "pd-validate",
    status: "active",
    ended_at: null
  });
  let startCalls = 0;

  const result = await runProcessRouteLifecycleTick(client, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    startProcess: async () => {
      startCalls += 1;
      throw new Error("unexpected start");
    }
  });

  assert.equal(result.action.type, "WAIT_PROCESS");
  assert.equal(result.observation.status, "active");
  assert.equal(startCalls, 0);
  assert.equal(client.calls.length, 1);
});

test("completed bound Process Instance advances route state but next unscheduled process waits for Planning/Scheduling", async () => {
  const snapshot = activeBoundRoute();
  const client = processClient({
    id: "pi-1",
    service_object_id: "so-1",
    process_def_id: "pd-validate",
    status: "completed",
    ended_at: "2026-08-31T00:30:00.000Z"
  });
  let starts = 0;

  const result = await runProcessRouteLifecycleTick(client, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T00:30:00.000Z",
    startProcess: async () => {
      starts += 1;
      throw new Error("SHOULD_NOT_START");
    }
  });

  assert.equal(result.observation.status, "completed");
  assert.equal(result.snapshot.steps[0].state, "COMPLETED");
  assert.equal(result.snapshot.steps[0].completed_at, "2026-08-31T00:30:00.000Z");
  assert.equal(result.snapshot.steps[1].state, "PENDING");
  assert.equal(result.action.type, "WAIT_SCHEDULE");
  assert.equal(result.action.step_code, "PLAN");
  assert.equal(starts, 0);
});

test("completed final Process Instance emits route completion and does not start another process", async () => {
  const single = route([
    {
      step_code: "VALIDATE",
      sequence: 100,
      process_def_id: "pd-validate",
      process_code: "VALIDATE_ORDER",
      process_version: 2
    }
  ]);
  const snapshot = activeBoundRoute(single);
  const client = processClient({
    id: "pi-1",
    service_object_id: "so-1",
    process_def_id: "pd-validate",
    status: "completed",
    ended_at: "2026-08-31T00:30:00.000Z"
  });
  let startCalls = 0;

  const result = await runProcessRouteLifecycleTick(client, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    startProcess: async () => {
      startCalls += 1;
      throw new Error("unexpected start");
    }
  });

  assert.equal(result.snapshot.steps[0].state, "COMPLETED");
  assert.deepEqual(result.action, {
    type: "ROUTE_COMPLETE",
    service_object_id: "so-1"
  });
  assert.equal(startCalls, 0);
});

test("blocked bound Process Instance moves route to WAIT_BLOCKED", async () => {
  const snapshot = activeBoundRoute();
  const client = processClient({
    id: "pi-1",
    service_object_id: "so-1",
    process_def_id: "pd-validate",
    status: "blocked",
    ended_at: null
  });

  const result = await runProcessRouteLifecycleTick(client, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1"
  });

  assert.equal(result.snapshot.steps[0].state, "BLOCKED");
  assert.equal(result.action.type, "WAIT_BLOCKED");
  assert.equal(result.action.process_instance_id, "pi-1");
});

test("process outcome observation fails closed on service-object mismatch", async () => {
  const client = processClient({
    id: "pi-1",
    service_object_id: "so-other",
    process_def_id: "pd-validate",
    status: "active",
    ended_at: null
  });

  await assert.rejects(
    () => readProcessInstanceOutcome(
      client,
      {
        type: "WAIT_PROCESS",
        service_object_id: "so-1",
        process_instance_id: "pi-1"
      },
      { tenantId: "tenant-1", serviceObjectId: "so-1" }
    ),
    /ROUTE_PROCESS_INSTANCE_SERVICE_OBJECT_MISMATCH/
  );
});

test("unsupported Process Instance status fails closed", async () => {
  const snapshot = activeBoundRoute();
  const client = processClient({
    id: "pi-1",
    service_object_id: "so-1",
    process_def_id: "pd-validate",
    status: "cancelled",
    ended_at: "2026-08-31T00:20:00.000Z"
  });

  await assert.rejects(
    () => runProcessRouteLifecycleTick(client, snapshot, {
      tenantId: "tenant-1",
      identityId: "identity-1",
      serviceObjectId: "so-1"
    }),
    /PROCESS_INSTANCE_STATUS_UNSUPPORTED:cancelled/
  );
});

test("ended active Process Instance is treated as inconsistent rather than guessed completed", async () => {
  const snapshot = activeBoundRoute();
  const client = processClient({
    id: "pi-1",
    service_object_id: "so-1",
    process_def_id: "pd-validate",
    status: "active",
    ended_at: "2026-08-31T00:20:00.000Z"
  });

  await assert.rejects(
    () => runProcessRouteLifecycleTick(client, snapshot, {
      tenantId: "tenant-1",
      identityId: "identity-1",
      serviceObjectId: "so-1"
    }),
    /PROCESS_INSTANCE_STATE_INCONSISTENT/
  );
});
