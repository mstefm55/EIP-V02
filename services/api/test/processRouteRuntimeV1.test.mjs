import test from "node:test";
import assert from "node:assert/strict";

import { buildProcessRouteSnapshot } from "../src/core/orchestration/processRoutePlanner.js";
import {
  executeRouteStartAction,
  runProcessRouteTick
} from "../src/core/orchestration/processRouteRuntime.js";

function route() {
  return buildProcessRouteSnapshot(
    [
      {
        step_code: "VALIDATE",
        sequence: 100,
        process_def_id: "pd-validate",
        process_code: "VALIDATE_ORDER",
        process_version: 2,
        schedule_v1: {
          planned_start_at: "2026-08-31T08:00:00.000Z",
          planned_finish_at: "2026-08-31T09:00:00.000Z",
          source_code: "TEST_SCHEDULE",
          revision: "1"
        }
      },
      {
        step_code: "PLAN",
        sequence: 200,
        process_def_id: "pd-plan",
        process_code: "PLAN_WORK",
        process_version: 7,
        schedule_v1: {
          planned_start_at: "2026-08-31T10:00:00.000Z",
          planned_finish_at: "2026-08-31T11:00:00.000Z",
          source_code: "TEST_SCHEDULE",
          revision: "1"
        }
      }
    ],
    {
      createdAt: "2026-08-31T00:00:00.000Z",
      sourceCode: "MTO_JOB_SHOP",
      sourceVersion: 3
    }
  );
}

test("route runtime starts the pinned Process Definition once its persisted schedule is mature", async () => {
  const calls = [];
  const result = await runProcessRouteTick({}, route(), {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T08:00:00.000Z",
    startProcess: async (_client, input) => {
      calls.push(input);
      return { ok: true, item: { id: "pi-1" }, reused: false };
    }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    processDefId: "pd-validate",
    idempotencyKey: result.action.idempotency_key
  });
  assert.equal(result.snapshot.steps[0].state, "ACTIVE");
  assert.equal(result.snapshot.steps[0].process_instance_id, "pi-1");
  assert.equal(result.action.type, "PROCESS_STARTED");
  assert.equal(result.action.process_def_id, "pd-validate");
  assert.equal(result.maturity.schedule_revision, "1");
});

test("route runtime preserves createInstance reuse semantics", async () => {
  const result = await runProcessRouteTick({}, route(), {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T08:00:00.000Z",
    startProcess: async () => ({ ok: true, item: { id: "pi-existing" }, reused: true })
  });

  assert.equal(result.action.type, "PROCESS_REUSED");
  assert.equal(result.action.reused, true);
  assert.equal(result.snapshot.steps[0].process_instance_id, "pi-existing");
});

test("bound active route step waits and does not invoke Process Engine again", async () => {
  let starts = 0;
  const first = await runProcessRouteTick({}, route(), {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T08:00:00.000Z",
    startProcess: async () => {
      starts += 1;
      return { ok: true, item: { id: "pi-1" }, reused: false };
    }
  });

  const second = await runProcessRouteTick({}, first.snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T08:30:00.000Z",
    startProcess: async () => {
      starts += 1;
      throw new Error("SHOULD_NOT_START");
    }
  });

  assert.equal(starts, 1);
  assert.equal(second.action.type, "WAIT_PROCESS");
  assert.equal(second.action.process_instance_id, "pi-1");
});

test("route runtime fails closed when Process Engine start fails", async () => {
  await assert.rejects(
    () => runProcessRouteTick({}, route(), {
      tenantId: "tenant-1",
      identityId: "identity-1",
      serviceObjectId: "so-1",
      now: "2026-08-31T08:00:00.000Z",
      startProcess: async () => ({ ok: false, error: "PROCESS_DEF_NOT_FOUND" })
    }),
    /PROCESS_DEF_NOT_FOUND/
  );
});

test("route runtime rejects a service-object mismatch before starting", async () => {
  const snapshot = route();
  snapshot.steps[0].state = "ACTIVE";
  const action = {
    type: "START_PROCESS",
    service_object_id: "so-other",
    step_code: "VALIDATE",
    process_def_id: "pd-validate",
    idempotency_key: "route:test"
  };

  await assert.rejects(
    () => executeRouteStartAction({}, snapshot, action, {
      tenantId: "tenant-1",
      identityId: "identity-1",
      serviceObjectId: "so-1",
      startProcess: async () => ({ ok: true, item: { id: "pi-1" } })
    }),
    /ROUTE_SERVICE_OBJECT_MISMATCH/
  );
});
