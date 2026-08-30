import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProcessRouteSnapshot,
  resolveNextRouteStep,
  transitionRouteStep,
  isProcessRouteComplete
} from "../src/core/orchestration/processRoutePlanner.js";

test("route snapshot orders explicit process steps and preserves process version provenance", () => {
  const snapshot = buildProcessRouteSnapshot(
    [
      { step_code: "SHIP", sequence: 300, process_def_id: "pd-ship", process_code: "SHIP", process_version: 4 },
      { step_code: "VALIDATE", sequence: 100, process_def_id: "pd-validate", process_code: "VALIDATE", process_version: 2 },
      { step_code: "PLAN", sequence: 200, process_def_id: "pd-plan", process_code: "PLAN", process_version: 7 }
    ],
    { sourceCode: "ORDER_STANDARD", sourceVersion: 3, createdAt: "2026-08-30T00:00:00.000Z" }
  );

  assert.deepEqual(snapshot.steps.map((step) => step.step_code), ["VALIDATE", "PLAN", "SHIP"]);
  assert.equal(snapshot.steps[1].process_def_id, "pd-plan");
  assert.equal(snapshot.steps[1].process_version, 7);
  assert.equal(snapshot.source_code, "ORDER_STANDARD");
});

test("route planner ignores pre-resolved non-applicable entries without owning business conditions", () => {
  const snapshot = buildProcessRouteSnapshot([
    { step_code: "A", process_def_id: "pd-a" },
    { step_code: "B", process_def_id: "pd-b", applicable: false },
    { step_code: "C", process_def_id: "pd-c", enabled: false }
  ]);
  assert.deepEqual(snapshot.steps.map((step) => step.step_code), ["A"]);
});

test("route step lifecycle advances sequentially", () => {
  let snapshot = buildProcessRouteSnapshot([
    { step_code: "VALIDATE", sequence: 100, process_def_id: "pd-1" },
    { step_code: "EXECUTE", sequence: 200, process_def_id: "pd-2" }
  ]);

  assert.equal(resolveNextRouteStep(snapshot).step_code, "VALIDATE");
  snapshot = transitionRouteStep(snapshot, "VALIDATE", "ACTIVE");
  snapshot = transitionRouteStep(snapshot, "VALIDATE", "COMPLETED");
  assert.equal(resolveNextRouteStep(snapshot).step_code, "EXECUTE");
  snapshot = transitionRouteStep(snapshot, "EXECUTE", "ACTIVE");
  snapshot = transitionRouteStep(snapshot, "EXECUTE", "COMPLETED");
  assert.equal(resolveNextRouteStep(snapshot), null);
  assert.equal(isProcessRouteComplete(snapshot), true);
});

test("route planner prevents two simultaneously active process steps in V1", () => {
  let snapshot = buildProcessRouteSnapshot([
    { step_code: "A", process_def_id: "pd-a" },
    { step_code: "B", process_def_id: "pd-b", sequence: 200 }
  ]);
  snapshot = transitionRouteStep(snapshot, "A", "ACTIVE");
  assert.throws(() => transitionRouteStep(snapshot, "B", "ACTIVE"), /ROUTE_ACTIVE_STEP_CONFLICT:A/);
});

test("route planner is bounded", () => {
  assert.throws(
    () => buildProcessRouteSnapshot(
      [
        { step_code: "A", process_def_id: "pd-a" },
        { step_code: "B", process_def_id: "pd-b" }
      ],
      { maxSteps: 1 }
    ),
    /ROUTE_STEP_LIMIT_EXCEEDED/
  );
});
