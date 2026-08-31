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
import { resolveRouteStepTemporalEligibility } from "../src/core/orchestration/processRouteTemporalGate.js";

const WEEKDAY_CALENDAR = [
  {
    timezone: "UTC",
    weekly: {
      MONDAY: [{ start: "08:00", end: "17:00" }],
      TUESDAY: [{ start: "08:00", end: "17:00" }],
      WEDNESDAY: [{ start: "08:00", end: "17:00" }],
      THURSDAY: [{ start: "08:00", end: "17:00" }],
      FRIDAY: [{ start: "08:00", end: "17:00" }]
    }
  }
];

function route(secondTemporal = null) {
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
        process_version: 1,
        attrs: secondTemporal ? { temporal_v1: secondTemporal } : {}
      }
    ],
    {
      createdAt: "2026-08-31T00:00:00.000Z",
      sourceCode: "TEST_ROUTE",
      sourceVersion: 1
    }
  );
}

function pendingSecond(secondTemporal) {
  const snapshot = route(secondTemporal);
  snapshot.steps[0].state = "COMPLETED";
  snapshot.steps[0].completed_at = "2026-08-31T16:30:00.000Z";
  return snapshot;
}

test("future not-before keeps route step PENDING and does not start Process Instance", async () => {
  const snapshot = pendingSecond({ not_before_at: "2026-08-31T12:00:00.000Z" });
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
  assert.equal(result.snapshot.steps[1].state, "PENDING");
  assert.equal(starts, 0);
});

test("route step starts once not-before instant is reached", async () => {
  const snapshot = pendingSecond({ not_before_at: "2026-08-31T12:00:00.000Z" });

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
});

test("calendar code delays a start until the next working instant", async () => {
  const snapshot = pendingSecond({ calendar_code: "SITE_DEFAULT" });

  const result = await runProcessRouteTick({}, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T18:00:00.000Z",
    calendarLayersByCode: { SITE_DEFAULT: WEEKDAY_CALENDAR }
  });

  assert.equal(result.action.type, "WAIT_TIME");
  assert.equal(result.action.reason, "CALENDAR_CLOSED");
  assert.equal(result.action.eligible_at, "2026-09-01T08:00:00.000Z");
  assert.equal(result.snapshot.steps[1].state, "PENDING");
});

test("working delay after previous completion composes existing calendar arithmetic", () => {
  const snapshot = pendingSecond({
    working_delay_after_previous_minutes: 120,
    calendar_code: "SITE_DEFAULT"
  });
  const step = snapshot.steps[1];

  const decision = resolveRouteStepTemporalEligibility(snapshot, step, {
    now: "2026-08-31T17:00:00.000Z",
    calendarLayersByCode: { SITE_DEFAULT: WEEKDAY_CALENDAR }
  });

  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "PREVIOUS_WORKING_DELAY");
  assert.equal(decision.eligible_at, "2026-09-01T09:30:00.000Z");
});

test("completed Process Instance is timestamped and next timed step waits instead of starting immediately", async () => {
  const snapshot = route({ not_before_at: "2026-08-31T12:00:00.000Z" });
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
  assert.equal(result.action.type, "WAIT_TIME");
  assert.equal(starts, 0);
});

test("referenced calendar must be resolved and fails closed when missing", () => {
  const snapshot = pendingSecond({ calendar_code: "SITE_DEFAULT" });
  assert.throws(
    () => resolveRouteStepTemporalEligibility(snapshot, snapshot.steps[1], {
      now: "2026-08-31T10:00:00.000Z"
    }),
    /ROUTE_CALENDAR_NOT_RESOLVED:SITE_DEFAULT/
  );
});

test("elapsed and working previous-step delay modes cannot conflict", () => {
  const snapshot = pendingSecond({
    delay_after_previous_minutes: 30,
    working_delay_after_previous_minutes: 30,
    calendar_code: "SITE_DEFAULT"
  });
  assert.throws(
    () => resolveRouteStepTemporalEligibility(snapshot, snapshot.steps[1], {
      now: "2026-08-31T10:00:00.000Z",
      calendarLayersByCode: { SITE_DEFAULT: WEEKDAY_CALENDAR }
    }),
    /ROUTE_PREVIOUS_DELAY_MODE_CONFLICT/
  );
});

test("route initialization snapshots governed temporal metadata without business-specific runtime code", () => {
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

  assert.deepEqual(snapshot.steps[0].attrs.temporal_v1, {
    calendar_code: "SITE_DEFAULT",
    delay_after_previous_minutes: 45
  });
});

test("pending step schedule can move earlier without route migration", async () => {
  const snapshot = pendingSecond(null);
  let starts = 0;

  const laterPlan = await runProcessRouteTick({}, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T10:00:00.000Z",
    scheduleByStepCode: {
      SECOND: {
        planned_start_at: "2026-08-31T14:00:00.000Z",
        source_code: "CURRENT_SCHEDULE",
        revision: "41"
      }
    },
    startProcess: async () => {
      starts += 1;
      throw new Error("SHOULD_NOT_START");
    }
  });

  assert.equal(laterPlan.action.type, "WAIT_TIME");
  assert.equal(laterPlan.action.eligible_at, "2026-08-31T14:00:00.000Z");
  assert.equal(laterPlan.snapshot.steps[1].state, "PENDING");

  const earlierPlan = await runProcessRouteTick({}, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T11:00:00.000Z",
    scheduleByStepCode: {
      SECOND: {
        planned_start_at: "2026-08-31T11:00:00.000Z",
        source_code: "CURRENT_SCHEDULE",
        revision: "42"
      }
    },
    startProcess: async () => {
      starts += 1;
      return { ok: true, item: { id: "pi-second" }, reused: false };
    }
  });

  assert.equal(earlierPlan.action.type, "PROCESS_STARTED");
  assert.equal(earlierPlan.snapshot.steps[1].state, "ACTIVE");
  assert.equal(earlierPlan.temporal.schedule_revision, "42");
  assert.equal(starts, 1);
});

test("pending step schedule can move later while route remains unchanged", async () => {
  const snapshot = pendingSecond(null);

  const firstDecision = await runProcessRouteTick({}, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T10:00:00.000Z",
    scheduleByStepCode: {
      SECOND: {
        eligible_at: "2026-08-31T11:00:00.000Z",
        source_code: "CURRENT_SCHEDULE",
        revision: "7"
      }
    }
  });

  const delayedDecision = await runProcessRouteTick({}, snapshot, {
    tenantId: "tenant-1",
    identityId: "identity-1",
    serviceObjectId: "so-1",
    now: "2026-08-31T10:30:00.000Z",
    scheduleByStepCode: {
      SECOND: {
        eligible_at: "2026-08-31T15:00:00.000Z",
        source_code: "CURRENT_SCHEDULE",
        revision: "8"
      }
    }
  });

  assert.equal(firstDecision.action.type, "WAIT_TIME");
  assert.equal(firstDecision.action.eligible_at, "2026-08-31T11:00:00.000Z");
  assert.equal(delayedDecision.action.type, "WAIT_TIME");
  assert.equal(delayedDecision.action.eligible_at, "2026-08-31T15:00:00.000Z");
  assert.equal(delayedDecision.snapshot.steps[1].state, "PENDING");
  assert.equal(delayedDecision.temporal.schedule_revision, "8");
});
