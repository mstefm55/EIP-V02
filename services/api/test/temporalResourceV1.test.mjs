import test from "node:test";
import assert from "node:assert/strict";

import {
  addWorkingMinutes,
  subtractWorkingMinutes,
  workingMinutesBetween,
  resolveEffectiveDayIntervals
} from "../src/core/temporal/calendarResolver.js";
import { resolveCapacitySlot } from "../src/core/temporal/capacitySlotResolver.js";
import {
  resolveWorkstationCandidates,
  resolveWorkstationAvailability
} from "../src/core/resources/workstationResolver.js";

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

test("layered calendar handles public holiday and workstation partial override", () => {
  const publicCalendar = {
    timezone: "UTC",
    exceptions: [{ date: "2026-09-07", closed: true }]
  };
  const workstation = {
    timezone: "UTC",
    exceptions: [{ date: "2026-09-08", intervals: [{ start: "10:00", end: "15:00" }] }]
  };
  assert.deepEqual(resolveEffectiveDayIntervals([weekday, publicCalendar], "2026-09-07"), []);
  assert.deepEqual(resolveEffectiveDayIntervals([weekday, workstation], "2026-09-08"), [
    { start: "10:00", end: "15:00" }
  ]);
});

test("forward and backward working time skip weekend and holiday", () => {
  const holiday = { timezone: "UTC", exceptions: [{ date: "2026-09-07", closed: true }] };
  const forward = addWorkingMinutes([weekday, holiday], "2026-09-04T16:00:00Z", 120);
  assert.equal(forward.toISOString(), "2026-09-08T09:00:00.000Z");
  const backward = subtractWorkingMinutes([weekday, holiday], "2026-09-08T09:00:00Z", 120);
  assert.equal(backward.toISOString(), "2026-09-04T16:00:00.000Z");
});

test("summer shutdown range is honored", () => {
  const shutdown = {
    timezone: "UTC",
    exceptions: [{ start_date: "2026-08-01", end_date: "2026-08-21", closed: true }]
  };
  const result = addWorkingMinutes([weekday, shutdown], "2026-07-31T16:00:00Z", 120);
  assert.equal(result.toISOString(), "2026-08-24T09:00:00.000Z");
});

test("DST spring transition uses actual elapsed working minutes", () => {
  const calendar = {
    timezone: "America/New_York",
    weekly: { SUNDAY: [{ start: "00:00", end: "05:00" }] }
  };
  const minutes = workingMinutesBetween([calendar], "2026-03-08T05:00:00Z", "2026-03-08T09:00:00Z");
  assert.equal(minutes, 240);
});

test("finite forward scheduling respects existing reservation", () => {
  const slot = resolveCapacitySlot({
    calendar_layers: [weekday],
    anchor: "2026-09-01T08:00:00Z",
    duration_minutes: 180,
    reservations: [{ start: "2026-09-01T08:00:00Z", end: "2026-09-01T12:00:00Z" }]
  });
  assert.equal(slot.start.toISOString(), "2026-09-01T12:00:00.000Z");
  assert.equal(slot.end.toISOString(), "2026-09-01T15:00:00.000Z");
});

test("split scheduling can use multiple free intervals", () => {
  const slot = resolveCapacitySlot({
    calendar_layers: [weekday],
    anchor: "2026-09-01T08:00:00Z",
    duration_minutes: 300,
    allow_split: true,
    reservations: [{ start: "2026-09-01T10:00:00Z", end: "2026-09-01T16:00:00Z" }]
  });
  assert.equal(slot.segments.length, 3);
  assert.equal(slot.start.toISOString(), "2026-09-01T08:00:00.000Z");
  assert.equal(slot.end.toISOString(), "2026-09-02T10:00:00.000Z");
});

test("finite backward scheduling finds latest slot", () => {
  const slot = resolveCapacitySlot({
    calendar_layers: [weekday],
    anchor: "2026-09-01T17:00:00Z",
    duration_minutes: 180,
    direction: "BACKWARD",
    reservations: [{ start: "2026-09-01T13:00:00Z", end: "2026-09-01T15:00:00Z" }]
  });
  assert.equal(slot.start.toISOString(), "2026-09-01T10:00:00.000Z");
  assert.equal(slot.end.toISOString(), "2026-09-01T13:00:00.000Z");
});

test("workstation resolver is domain-neutral across factory hospital and fleet projections", () => {
  const candidates = [
    { id: "cnc", capabilities: ["CNC_5_AXIS", "METAL"], mobility: "FIXED", capacity: { kg: 1000 } },
    { id: "theatre", capabilities: ["SURGERY", "ANESTHESIA"], mobility: "FIXED", capacity: { persons: 8 } },
    { id: "truck", capabilities: ["REFRIGERATED", "DELIVERY"], mobility: "MOBILE", capacity: { kg: 1800 } }
  ];
  assert.equal(resolveWorkstationCandidates(candidates, { capabilities_all: ["CNC_5_AXIS"] })[0].id, "cnc");
  assert.equal(resolveWorkstationCandidates(candidates, { capabilities_all: ["SURGERY", "ANESTHESIA"] })[0].id, "theatre");
  assert.equal(resolveWorkstationCandidates(candidates, { capabilities_all: ["REFRIGERATED"], mobility: "MOBILE", capacity_minimums: { kg: 800 } })[0].id, "truck");
});

test("workstation candidate limit fails closed", () => {
  assert.throws(
    () => resolveWorkstationCandidates([{ id: 1 }, { id: 2 }], {}, { maxCandidates: 1 }),
    /WORKSTATION_CANDIDATE_LIMIT_EXCEEDED/
  );
});

test("workstation availability chooses earliest free capable workstation", () => {
  const candidates = [
    {
      id: "line-a",
      capabilities: ["ASSEMBLY"],
      calendar_layers: [weekday],
      reservations: [{ start: "2026-09-01T08:00:00Z", end: "2026-09-01T16:00:00Z" }]
    },
    {
      id: "line-b",
      capabilities: ["ASSEMBLY"],
      calendar_layers: [weekday],
      reservations: []
    }
  ];
  const results = resolveWorkstationAvailability(
    candidates,
    { capabilities_all: ["ASSEMBLY"] },
    { anchor: "2026-09-01T08:00:00Z", duration_minutes: 120 }
  );
  assert.equal(results[0].candidate.id, "line-b");
  assert.equal(results[0].slot.end.toISOString(), "2026-09-01T10:00:00.000Z");
});
