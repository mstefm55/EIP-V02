import test from "node:test";
import assert from "node:assert/strict";

import { buildProcessRouteSnapshot } from "../src/core/orchestration/processRoutePlanner.js";
import {
  applyProcessInstanceOutcome,
  bindRouteStepInstance,
  buildRouteStepIdempotencyKey,
  coordinateProcessRoute,
  resumeBlockedRouteStep
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

test("coordinator activates first pending step and emits bounded start command", () => {
  const result = coordinateProcessRoute(route(), { serviceObjectId: "so-1" });

  assert.equal(result.snapshot.steps[0].state, "ACTIVE");
  assert.equal(result.snapshot.steps[1].state, "PENDING");
  assert.deepEqual(
    {
      type: result.action.type,
      service_object_id: result.action.service_object_id,
      step_code: result.action.step_code,
      process_def_id: result.action.process_def_id,
      process_version: result.action.process_version
    },
    {
      type: "START_PROCESS",
      service_object_id: "so-1",
      step_code: "VALIDATE",
      process_def_id: "pd-validate",
      process_version: 2
    }
  );
  assert.match(result.action.idempotency_key, /^route:[0-9a-f]{64}$/);
});

test("start command idempotency key is stable for the same route step", () => {
  const snapshot = route();
  const first = coordinateProcessRoute(snapshot, { serviceObjectId: "so-1" });
  const repeated = coordinateProcessRoute(first.snapshot, { serviceObjectId: "so-1" });

  assert.equal(first.action.type, "START_PROCESS");
  assert.equal(repeated.action.type, "START_PROCESS");
  assert.equal(first.action.idempotency_key, repeated.action.idempotency_key);

  const direct = buildRouteStepIdempotencyKey(first.snapshot, {
    serviceObjectId: "so-1",
    step: first.snapshot.steps[0]
  });
  assert.equal(direct, first.action.idempotency_key);
});

test("bound active step waits for its Process Instance rather than starting another", () => {
  const started = coordinateProcessRoute(route(), { serviceObjectId: "so-1" });
  const bound = bindRouteStepInstance(started.snapshot, "VALIDATE", "pi-1");
  const result = coordinateProcessRoute(bound, { serviceObjectId: "so-1" });

  assert.deepEqual(result.action, {
    type: "WAIT_PROCESS",
    service_object_id: "so-1",
    step_code: "VALIDATE",
    process_instance_id: "pi-1"
  });
});

test("completed Process Instance advances route to the next Process Definition", () => {
  const first = coordinateProcessRoute(route(), { serviceObjectId: "so-1" });
  const bound = bindRouteStepInstance(first.snapshot, "VALIDATE", "pi-1");
  const completed = applyProcessInstanceOutcome(bound, {
    processInstanceId: "pi-1",
    status: "completed"
  });

  assert.equal(completed.steps[0].state, "COMPLETED");

  const next = coordinateProcessRoute(completed, { serviceObjectId: "so-1" });
  assert.equal(next.snapshot.steps[1].state, "ACTIVE");
  assert.equal(next.action.type, "START_PROCESS");
  assert.equal(next.action.step_code, "PLAN");
  assert.equal(next.action.process_def_id, "pd-plan");
});

test("replayed completed outcome is idempotent", () => {
  const first = coordinateProcessRoute(route(), { serviceObjectId: "so-1" });
  const bound = bindRouteStepInstance(first.snapshot, "VALIDATE", "pi-1");
  const completed = applyProcessInstanceOutcome(bound, {
    processInstanceId: "pi-1",
    status: "completed"
  });
  const replayed = applyProcessInstanceOutcome(completed, {
    processInstanceId: "pi-1",
    status: "completed"
  });

  assert.deepEqual(replayed, completed);
});

test("blocked Process Instance pauses route until explicitly resumed", () => {
  const first = coordinateProcessRoute(route(), { serviceObjectId: "so-1" });
  const bound = bindRouteStepInstance(first.snapshot, "VALIDATE", "pi-1");
  const blocked = applyProcessInstanceOutcome(bound, {
    processInstanceId: "pi-1",
    status: "blocked"
  });

  const waiting = coordinateProcessRoute(blocked, { serviceObjectId: "so-1" });
  assert.equal(waiting.action.type, "WAIT_BLOCKED");
  assert.equal(waiting.action.process_instance_id, "pi-1");

  const resumed = resumeBlockedRouteStep(blocked, "VALIDATE");
  const afterResume = coordinateProcessRoute(resumed, { serviceObjectId: "so-1" });
  assert.equal(afterResume.action.type, "WAIT_PROCESS");
});

test("instance binding conflicts fail closed", () => {
  const first = coordinateProcessRoute(route(), { serviceObjectId: "so-1" });
  const bound = bindRouteStepInstance(first.snapshot, "VALIDATE", "pi-1");

  assert.throws(
    () => bindRouteStepInstance(bound, "VALIDATE", "pi-2"),
    /ROUTE_STEP_INSTANCE_CONFLICT:VALIDATE/
  );
});

test("unknown Process Instance outcomes fail closed", () => {
  assert.throws(
    () => applyProcessInstanceOutcome(route(), { processInstanceId: "pi-missing", status: "completed" }),
    /ROUTE_PROCESS_INSTANCE_NOT_BOUND:pi-missing/
  );
});

test("fully completed route emits route completion instead of another process start", () => {
  let snapshot = route();

  let tick = coordinateProcessRoute(snapshot, { serviceObjectId: "so-1" });
  snapshot = bindRouteStepInstance(tick.snapshot, "VALIDATE", "pi-1");
  snapshot = applyProcessInstanceOutcome(snapshot, { processInstanceId: "pi-1", status: "completed" });

  tick = coordinateProcessRoute(snapshot, { serviceObjectId: "so-1" });
  snapshot = bindRouteStepInstance(tick.snapshot, "PLAN", "pi-2");
  snapshot = applyProcessInstanceOutcome(snapshot, { processInstanceId: "pi-2", status: "completed" });

  const done = coordinateProcessRoute(snapshot, { serviceObjectId: "so-1" });
  assert.deepEqual(done.action, {
    type: "ROUTE_COMPLETE",
    service_object_id: "so-1"
  });
});
