import test from "node:test";
import assert from "node:assert/strict";

import {
  projectRouteScheduleRows,
  projectServiceObjectRouteSchedule
} from "../src/core/orchestration/processRouteScheduleProjection.js";

function rowWithSteps(steps) {
  return {
    id: "so-1",
    code: "SO-001",
    title: "Example Order",
    object_type: "ORDER",
    status: "active",
    updated_at: "2026-09-01T08:00:00.000Z",
    route_snapshot: {
      version: 1,
      steps
    }
  };
}

test("projection flattens persisted route schedule without recalculating it", () => {
  const items = projectServiceObjectRouteSchedule(
    rowWithSteps([
      {
        step_code: "PREP",
        sequence: 100,
        process_def_id: "pd-prep",
        process_code: "PREPARE",
        process_version: 2,
        state: "PENDING",
        schedule_v1: {
          planned_start_at: "2026-09-01T10:00:00.000Z",
          planned_finish_at: "2026-09-01T12:00:00.000Z",
          source_code: "CURRENT_SCHEDULE",
          revision: "7"
        }
      },
      {
        step_code: "EXECUTE",
        sequence: 200,
        process_def_id: "pd-exec",
        process_code: "EXECUTE",
        process_version: 3,
        state: "PENDING"
      }
    ]),
    { now: "2026-09-01T09:00:00.000Z" }
  );

  assert.equal(items.length, 2);
  assert.equal(items[0].planned_start_at, "2026-09-01T10:00:00.000Z");
  assert.equal(items[0].planned_finish_at, "2026-09-01T12:00:00.000Z");
  assert.equal(items[0].scheduled, true);
  assert.equal(items[0].mature, false);
  assert.equal(items[0].wait_reason, "PLANNED_START");
  assert.equal(items[0].schedule_revision, "7");
  assert.equal(items[1].scheduled, false);
  assert.equal(items[1].wait_reason, "SCHEDULE_REQUIRED");
});

test("completed step exposes actual completion separately from planned dates", () => {
  const [item] = projectServiceObjectRouteSchedule(
    rowWithSteps([
      {
        step_code: "DONE",
        sequence: 100,
        process_def_id: "pd-done",
        process_code: "DONE_PROCESS",
        process_version: 1,
        state: "COMPLETED",
        completed_at: "2026-09-01T11:25:00.000Z",
        schedule_v1: {
          planned_start_at: "2026-09-01T08:00:00.000Z",
          planned_finish_at: "2026-09-01T11:00:00.000Z"
        }
      }
    ]),
    { now: "2026-09-01T12:00:00.000Z" }
  );

  assert.equal(item.route_state, "COMPLETED");
  assert.equal(item.actual_completed_at, "2026-09-01T11:25:00.000Z");
  assert.equal(item.planned_finish_at, "2026-09-01T11:00:00.000Z");
  assert.equal(item.wait_reason, "COMPLETED");
});

test("invalid persisted schedule fails closed instead of being repaired for UI", () => {
  assert.throws(
    () => projectServiceObjectRouteSchedule(
      rowWithSteps([
        {
          step_code: "BAD",
          process_def_id: "pd-bad",
          state: "PENDING",
          schedule_v1: {
            planned_start_at: "2026-09-01T12:00:00.000Z",
            planned_finish_at: "2026-09-01T10:00:00.000Z"
          }
        }
      ]),
      { now: "2026-09-01T09:00:00.000Z" }
    ),
    /ROUTE_SCHEDULE_RANGE_INVALID/
  );
});

test("unsupported route state fails closed", () => {
  assert.throws(
    () => projectServiceObjectRouteSchedule(
      rowWithSteps([
        {
          step_code: "UNKNOWN",
          process_def_id: "pd-1",
          state: "PAUSED"
        }
      ])
    ),
    /ROUTE_STATE_UNSUPPORTED/
  );
});

test("multi-service-object projection is bounded", () => {
  const rows = [
    rowWithSteps([{ step_code: "A", process_def_id: "pd-a", state: "PENDING" }]),
    { ...rowWithSteps([{ step_code: "B", process_def_id: "pd-b", state: "PENDING" }]), id: "so-2" }
  ];

  assert.throws(
    () => projectRouteScheduleRows(rows, { maxServiceObjects: 1 }),
    /ROUTE_PROJECTION_SERVICE_OBJECT_LIMIT_EXCEEDED/
  );
  assert.throws(
    () => projectRouteScheduleRows(rows, { maxProjectedSteps: 1 }),
    /ROUTE_PROJECTION_STEP_LIMIT_EXCEEDED/
  );
});
