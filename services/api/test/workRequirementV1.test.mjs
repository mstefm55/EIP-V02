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

const dyeBatchRequirement = {
  workload: { amount: 1000, unit: "kg" },
  batch_cycle: {
    process_code: "DYEING",
    components: [
      { code: "FILL", source: "RESOURCE_STANDARD", key: "fill_minutes" },
      { code: "PROCESS", source: "PROCESS", minutes: 360 },
      { code: "DRAIN", source: "RESOURCE_STANDARD", key: "drain_minutes" },
      { code: "CLEAN", source: "RESOURCE_STANDARD", key: "clean_minutes" }
    ]
  }
};

function dyeMachine(id, standard, load) {
  return {
    id,
    capabilities: ["DYEING_MACHINE"],
    process_standards: {
      DYEING: {
        ...standard,
        load
      }
    },
    calendar_layers: [weekday],
    reservations: []
  };
}

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

test("batch-cycle duration composes process time with asset-specific machine standards", () => {
  const machines = [
    dyeMachine("machine-a", { fill_minutes: 48, drain_minutes: 42, clean_minutes: 30 }, {
      unit: "kg", min: 400, average: 900, max: 1200, min_policy: "SOFT"
    }),
    dyeMachine("machine-b", { fill_minutes: 24, drain_minutes: 36, clean_minutes: 30 }, {
      unit: "kg", min: 350, average: 700, max: 1100, min_policy: "SOFT"
    }),
    dyeMachine("machine-c", { fill_minutes: 90, drain_minutes: 78, clean_minutes: 60 }, {
      unit: "kg", min: 500, average: 1200, max: 1500, min_policy: "SOFT"
    })
  ];

  const results = machines.map((machine) => resolveCandidateWorkDuration(machine, dyeBatchRequirement));

  assert.deepEqual(results.map((item) => item.duration_minutes), [480, 450, 588]);
  assert.deepEqual(results.map((item) => item.source), ["BATCH_CYCLE", "BATCH_CYCLE", "BATCH_CYCLE"]);
  assert.equal(results[0].load.status, "ABOVE_AVERAGE");
  assert.equal(results[1].load.status, "ABOVE_AVERAGE");
  assert.equal(results[2].load.status, "BELOW_AVERAGE");
  assert.equal(results[0].components[1].minutes, 360);
});

test("batch-cycle load envelope rejects a load above asset/process maximum", () => {
  const machine = dyeMachine(
    "machine-a",
    { fill_minutes: 48, drain_minutes: 42, clean_minutes: 30 },
    { unit: "kg", min: 400, average: 900, max: 950, min_policy: "SOFT" }
  );

  assert.throws(
    () => resolveCandidateWorkDuration(machine, dyeBatchRequirement),
    /WORK_REQUIREMENT_LOAD_ABOVE_MAX:DYEING/
  );
});

test("hard minimum load fails closed while soft minimum remains schedulable with provenance", () => {
  const hard = dyeMachine(
    "machine-hard",
    { fill_minutes: 48, drain_minutes: 42, clean_minutes: 30 },
    { unit: "kg", min: 1100, average: 1200, max: 1500, min_policy: "HARD" }
  );
  const soft = dyeMachine(
    "machine-soft",
    { fill_minutes: 48, drain_minutes: 42, clean_minutes: 30 },
    { unit: "kg", min: 1100, average: 1200, max: 1500, min_policy: "SOFT" }
  );

  assert.throws(
    () => resolveCandidateWorkDuration(hard, dyeBatchRequirement),
    /WORK_REQUIREMENT_LOAD_BELOW_MIN:DYEING/
  );

  const result = resolveCandidateWorkDuration(soft, dyeBatchRequirement);
  assert.equal(result.load.status, "BELOW_MIN");
  assert.equal(result.load.min, 1100);
  assert.equal(result.load.average, 1200);
  assert.equal(result.load.max, 1500);
});

test("batch-cycle workstation ranking uses asset-specific cycle duration after load validation", () => {
  const candidates = [
    dyeMachine("machine-a", { fill_minutes: 48, drain_minutes: 42, clean_minutes: 30 }, {
      unit: "kg", min: 400, average: 900, max: 1200, min_policy: "SOFT"
    }),
    dyeMachine("machine-b", { fill_minutes: 24, drain_minutes: 36, clean_minutes: 30 }, {
      unit: "kg", min: 350, average: 700, max: 1100, min_policy: "SOFT"
    }),
    dyeMachine("machine-c", { fill_minutes: 90, drain_minutes: 78, clean_minutes: 60 }, {
      unit: "kg", min: 500, average: 1200, max: 1500, min_policy: "SOFT"
    })
  ];

  const results = resolveWorkstationAvailability(
    candidates,
    { capabilities_all: ["DYEING_MACHINE"] },
    {
      anchor: "2026-09-07T08:00:00Z",
      direction: "FORWARD",
      // This test is about candidate-specific duration/ranking, not contiguous-slot feasibility.
      // Allow split placement so the 588-minute candidate remains in the comparison set.
      allow_split: true,
      work_requirement: dyeBatchRequirement
    }
  );

  assert.deepEqual(results.map((item) => item.candidate.id), ["machine-b", "machine-a", "machine-c"]);
  assert.deepEqual(results.map((item) => item.work.duration_minutes), [450, 480, 588]);
});
