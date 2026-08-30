import test from "node:test";
import assert from "node:assert/strict";

import { resolveCandidateWorkDuration } from "../src/core/resources/workRequirementResolver.js";
import { resolveWorkstationAvailability } from "../src/core/resources/workstationResolver.js";

const weekday = {
  timezone: "UTC",
  weekly: {
    MONDAY: [{ start: "08:00", end: "17:00" }],
    TUESDAY: [{ start: "08:00", end: "17:00" }],
    WEDNESDAY: [{ start: "08:00", end: "17:00" }],
    THURSDAY: [{ start: "08:00", end: "17:00" }],
    FRIDAY: [{ start: "08:00", end: "17:00" }]
  }
};

test("fixed process duration remains independent of workstation rate", () => {
  const result = resolveCandidateWorkDuration(
    { id: "room-a", capacity: { cases_per_hour: 3 } },
    { duration_minutes: 90, fixed_overhead_minutes: 15 }
  );
  assert.equal(result.source, "FIXED");
  assert.equal(result.duration_minutes, 105);
});

test("rate-dependent workload converts process work into candidate-specific duration", () => {
  const result = resolveCandidateWorkDuration(
    { id: "line-b", capacity: { pieces_per_hour: 800 } },
    {
      workload: { amount: 10000, unit: "piece" },
      rate: { capacity_key: "pieces_per_hour", workload_unit: "piece", period_minutes: 60 }
    }
  );
  assert.equal(result.source, "RATE");
  assert.equal(result.duration_minutes, 750);
});

test("workstation selection considers candidate-specific process duration before calendar slot ranking", () => {
  const candidates = [
    {
      id: "line-a",
      capabilities: ["ASSEMBLY"],
      capacity: { pieces_per_hour: 500 },
      calendar_layers: [weekday],
      reservations: []
    },
    {
      id: "line-b",
      capabilities: ["ASSEMBLY"],
      capacity: { pieces_per_hour: 800 },
      calendar_layers: [weekday],
      reservations: []
    }
  ];

  const results = resolveWorkstationAvailability(
    candidates,
    { capabilities_all: ["ASSEMBLY"] },
    {
      anchor: "2026-09-07T08:00:00Z",
      direction: "FORWARD",
      allow_split: true,
      work_requirement: {
        workload: { amount: 10000, unit: "piece" },
        rate: { capacity_key: "pieces_per_hour", workload_unit: "piece", period_minutes: 60 }
      }
    }
  );

  assert.equal(results[0].candidate.id, "line-b");
  assert.equal(results[0].work.duration_minutes, 750);
  assert.equal(results[1].candidate.id, "line-a");
  assert.equal(results[1].work.duration_minutes, 1200);
});

test("workload/rate unit mismatch fails closed", () => {
  assert.throws(
    () => resolveCandidateWorkDuration(
      { id: "x", capacity: { kg_per_hour: 10 } },
      {
        workload: { amount: 50, unit: "case" },
        rate: { capacity_key: "kg_per_hour", workload_unit: "kg" }
      }
    ),
    /WORK_REQUIREMENT_UNIT_MISMATCH/
  );
});

test("missing candidate rate fails closed", () => {
  assert.throws(
    () => resolveCandidateWorkDuration(
      { id: "x", capacity: {} },
      {
        workload: { amount: 50, unit: "case" },
        rate: { capacity_key: "cases_per_hour", workload_unit: "case" }
      }
    ),
    /WORK_REQUIREMENT_RATE_INVALID:cases_per_hour/
  );
});
