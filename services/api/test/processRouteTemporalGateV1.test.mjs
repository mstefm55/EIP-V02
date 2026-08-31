import test from "node:test";
import assert from "node:assert/strict";

import { buildProcessRouteSnapshot } from "../src/core/orchestration/processRoutePlanner.js";
import {
  bindRouteStepInstance,
  coordinateProcessRoute
} from "../src/core/orchestration/processRouteCoordinator.js";
import { runProcessRouteTick } from "../src/core/orchestration/processRouteRuntime.js";
import { runProcessRouteLifecycleTick } from "../src/core/orchestration/processRouteLifecycleRuntime.js";
import { buildProcessRouteFromCandidates } from "../src/core/orchestration/processRouteInitialization.js";
import {
  normalizeRouteStepSchedule,
  resolveRouteStepMaturity
} from "../src/core/orchestration/processRouteTemporalGate.js";

function route() {
  return buildProcessRouteSnapshot(
    [
      {
        step_code: "FIRST",
        sequence: 100,
        process_def_id: "pd-first",
        process_code: "FIRST_PROCESS",
        process_version: 1
      },
      {
        step_code: "SECOND",
        sequence: 200,
        process_def_id: "pd-second",
        process_code: "SECOND_PROCESS",
        process_version: 1
      }
    ],
    {
      createdAt: "2026-08-31T00:00:00.000Z",
      sourceCode: "TEST_ROUTE",
      sourceVersion: 1
    }
  );
}

function setSchedule(snapshot, stepCode, schedule) {
  const step = snapshot.steps.find((candidate) => candidate.step_code === stepCode);
  if (!step) throw new Error(`TEST_STEP_NOT_FOUND:${stepCode}`);
  step.schedule_v1 = normalizeRouteStepSchedule(schedule, stepCode);
  return snapshot;
}

function pendingSecond() {
  const snapshot = route();
  snapshot.steps[0].state = "COMPLETED";
  snapshot.steps[0].completed_at = "2026-08-31T10:00:00.000Z";
  return snapshot;
}

test("unscheduled pending route step fails closed with WAIT_SCHEDULE", async () => {
  const snapshot = pendingSecond();
  let starts = 0;

  const result = await runProcessRouteTick({}, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T10:00:00.000Z",
    startProcess: async () => {
      starts += 1;
      throw new Error("SHOULD_NOT_START");
    }
  });

  assert.equal(result.action.type, "WAIT_SCHEDULE");
  assert.equal(result.action.step_code, "SECOND");
  assert.equal(result.maturity.scheduled, false);
  assert.equal(result.snapshot.steps[1].state, "PENDING");
  assert.equal(starts, 0);
});

test("persisted future planned start keeps route step PENDING", async () => {
  const snapshot = setSchedule(pendingSecond(), "SECOND", {
    planned_start_at: "2026-08-31T12:00:00.000Z",
    planned_finish_at: "2026-08-31T14:00:00.000Z",
    source_code: "CURRENT_SCHEDULE",
    revision: "41"
  });
  let starts = 0;

  const result = await runProcessRouteTick({}, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T10:00:00.000Z",
    startProcess: async () => {
      starts += 1;
      throw new Error("SHOULD_NOT_START");
    }
  });

  assert.equal(result.action.type, "WAIT_TIME");
  assert.equal(result.action.eligible_at, "2026-08-31T12:00:00.000Z");
  assert.equal(result.action.schedule_revision, "41");
  assert.equal(result.snapshot.steps[1].state, "PENDING");
  assert.equal(starts, 0);
});

test("route step starts once persisted planned start is reached", async () => {
  const snapshot = setSchedule(pendingSecond(), "SECOND", {
    planned_start_at: "2026-08-31T12:00:00.000Z",
    planned_finish_at: "2026-08-31T14:00:00.000Z",
    source_code: "CURRENT_SCHEDULE",
    revision: "42"
  });

  const result = await runProcessRouteTick({}, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T12:00:00.000Z",
    startProcess: async () => ({ ok: true, item: { id: "pi-second" }, reused: false })
  });

  assert.equal(result.action.type, "PROCESS_STARTED");
  assert.equal(result.snapshot.steps[1].state, "ACTIVE");
  assert.equal(result.snapshot.steps[1].process_instance_id, "pi-second");
  assert.equal(result.maturity.reason, "MATURE");
});

test("route maturity gate rejects an invalid persisted schedule range", () => {
  assert.throws(
    () => normalizeRouteStepSchedule({
      planned_start_at: "2026-08-31T12:00:00.000Z",
      planned_finish_at: "2026-08-31T11:00:00.000Z"
    }, "SECOND"),
    /ROUTE_SCHEDULE_RANGE_INVALID:SECOND/
  );
});

test("route maturity gate does not calculate calendars, delays or capacity", () => {
  const snapshot = setSchedule(pendingSecond(), "SECOND", {
    planned_start_at: "2026-09-01T09:30:00.000Z",
    planned_finish_at: "2026-09-01T11:30:00.000Z",
    source_code: "PLANNING_PROCESS",
    revision: "9"
  });

  const decision = resolveRouteStepMaturity(snapshot, snapshot.steps[1], {
    now: "2026-08-31T17:00:00.000Z",
    calendarLayersByCode: { SHOULD_BE_IGNORED: [{ invalid: true }] },
    scheduleByStepCode: { SHOULD_BE_IGNORED: { planned_start_at: "2026-08-31T17:00:00.000Z" } }
  });

  assert.equal(decision.mature, false);
  assert.equal(decision.planned_start_at, "2026-09-01T09:30:00.000Z");
  assert.equal(decision.schedule_source_code, "PLANNING_PROCESS");
  assert.equal(decision.schedule_revision, "9");
});

test("completed Process Instance records actual completion then next unscheduled step waits for Planning/Scheduling", async () => {
  const snapshot = route();
  setSchedule(snapshot, "FIRST", {
    planned_start_at: "2026-08-31T08:00:00.000Z",
    planned_finish_at: "2026-08-31T10:00:00.000Z",
    source_code: "CURRENT_SCHEDULE",
    revision: "1"
  });
  const coordinated = coordinateProcessRoute(snapshot, { serviceObjectId: "so-1" });
  const active = bindRouteStepInstance(coordinated.snapshot, "FIRST", "pi-first");
  let starts = 0;
  const client = {
    async query() {
      return {
        rowCount: 1,
        rows: [{
          id: "pi-first",
          service_object_id: "so-1",
          process_def_id: "pd-first",
          status: "completed",
          ended_at: "2026-08-31T10:00:00.000Z"
        }]
      };
    }
  };

  const result = await runProcessRouteLifecycleTick(client, active, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T10:00:00.000Z",
    startProcess: async () => {
      starts += 1;
      throw new Error("SHOULD_NOT_START");
    }
  });

  assert.equal(result.snapshot.steps[0].state, "COMPLETED");
  assert.equal(result.snapshot.steps[0].completed_at, "2026-08-31T10:00:00.000Z");
  assert.equal(result.snapshot.steps[1].state, "PENDING");
  assert.equal(result.action.type, "WAIT_SCHEDULE");
  assert.equal(starts, 0);
});

test("route initialization no longer snapshots scheduling policy into the pinned route", () => {
  const candidates = [
    {
      binding_id: "binding-1",
      binding_priority: 100,
      binding_task_type: null,
      binding_attrs: {
        route_v1: {
          step_code: "GENERIC_STEP",
          sequence: 100,
          temporal_v1: {
            calendar_code: "SITE_DEFAULT",
            delay_after_previous_minutes: 45
          }
        }
      },
      process_def_id: "pd-1",
      process_code: "GENERIC_PROCESS",
      process_version: 3
    }
  ];

  const snapshot = buildProcessRouteFromCandidates(candidates, {
    applicabilityByBindingId: { "binding-1": true },
    createdAt: "2026-08-31T00:00:00.000Z"
  });

  assert.equal(snapshot.steps[0].attrs.temporal_v1, undefined);
  assert.equal(snapshot.steps[0].schedule_v1, undefined);
});

test("pending schedule can move earlier through persisted route patch without route migration", async () => {
  const snapshot = setSchedule(pendingSecond(), "SECOND", {
    planned_start_at: "2026-08-31T14:00:00.000Z",
    planned_finish_at: "2026-08-31T16:00:00.000Z",
    source_code: "CURRENT_SCHEDULE",
    revision: "41"
  });

  const laterPlan = await runProcessRouteTick({}, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T10:00:00.000Z"
  });
  assert.equal(laterPlan.action.type, "WAIT_TIME");
  assert.equal(laterPlan.action.eligible_at, "2026-08-31T14:00:00.000Z");

  setSchedule(snapshot, "SECOND", {
    planned_start_at: "2026-08-31T11:00:00.000Z",
    planned_finish_at: "2026-08-31T13:00:00.000Z",
    source_code: "CURRENT_SCHEDULE",
    revision: "42"
  });

  const earlierPlan = await runProcessRouteTick({}, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T11:00:00.000Z",
    startProcess: async () => ({ ok: true, item: { id: "pi-second" }, reused: false })
  });

  assert.equal(earlierPlan.action.type, "PROCESS_STARTED");
  assert.equal(earlierPlan.maturity.schedule_revision, "42");
  assert.equal(earlierPlan.snapshot.steps[1].process_instance_id, "pi-second");
});

test("pending schedule can move later through persisted route patch without route migration", async () => {
  const snapshot = setSchedule(pendingSecond(), "SECOND", {
    planned_start_at: "2026-08-31T11:00:00.000Z",
    planned_finish_at: "2026-08-31T13:00:00.000Z",
    source_code: "CURRENT_SCHEDULE",
    revision: "7"
  });

  const firstDecision = await runProcessRouteTick({}, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T10:00:00.000Z"
  });

  setSchedule(snapshot, "SECOND", {
    planned_start_at: "2026-08-31T15:00:00.000Z",
    planned_finish_at: "2026-08-31T17:00:00.000Z",
    source_code: "CURRENT_SCHEDULE",
    revision: "8"
  });

  const delayedDecision = await runProcessRouteTick({}, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T10:30:00.000Z"
  });

  assert.equal(firstDecision.action.type, "WAIT_TIME");
  assert.equal(firstDecision.action.eligible_at, "2026-08-31T11:00:00.000Z");
  assert.equal(delayedDecision.action.type, "WAIT_TIME");
  assert.equal(delayedDecision.action.eligible_at, "2026-08-31T15:00:00.000Z");
  assert.equal(delayedDecision.maturity.schedule_revision, "8");
  assert.equal(delayedDecision.snapshot.steps[1].state, "PENDING");
});
