import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveEffectiveDayIntervals,
  isWorkingInstant,
  nextWorkingInstant,
  addWorkingMinutes,
  subtractWorkingMinutes,
  workingMinutesBetween
} from "../src/core/temporal/calendarResolver.js";
import { resolveCapacitySlot } from "../src/core/temporal/capacitySlotResolver.js";

const layers = [
  {
    timezone: "UTC",
    weekly: {
      MONDAY: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }],
      TUESDAY: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }],
      WEDNESDAY: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }],
      THURSDAY: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }],
      FRIDAY: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }],
      SATURDAY: [],
      SUNDAY: []
    },
    exceptions: [
      { date: "2026-09-07", closed: true }
    ]
  }
];

test("calendar resolver applies weekly working intervals and explicit closures", () => {
  assert.deepEqual(resolveEffectiveDayIntervals(layers, "2026-09-08"), [
    { start: "08:00", end: "12:00" },
    { start: "13:00", end: "17:00" }
  ]);
  assert.deepEqual(resolveEffectiveDayIntervals(layers, "2026-09-07"), []);
});

test("working-time arithmetic crosses closures and non-working periods deterministically", () => {
  const start = new Date("2026-09-04T16:00:00.000Z");
  const finish = addWorkingMinutes(layers, start, 180);
  assert.equal(finish.toISOString(), "2026-09-08T10:00:00.000Z");

  const reversed = subtractWorkingMinutes(layers, finish, 180);
  assert.equal(reversed.toISOString(), start.toISOString());

  assert.equal(
    workingMinutesBetween(layers, start, finish),
    180
  );
});

test("working instant helpers respect the governed calendar", () => {
  assert.equal(isWorkingInstant(layers, "2026-09-04T16:30:00.000Z"), true);
  assert.equal(isWorkingInstant(layers, "2026-09-05T10:00:00.000Z"), false);
  assert.equal(
    nextWorkingInstant(layers, "2026-09-05T10:00:00.000Z").toISOString(),
    "2026-09-08T08:00:00.000Z"
  );
});

test("capacity-slot resolver composes calendar availability with bounded reservations", () => {
  const slot = resolveCapacitySlot({
    calendar_layers: layers,
    anchor: "2026-09-08T08:00:00.000Z",
    duration_minutes: 120,
    direction: "FORWARD",
    reservations: [
      { start: "2026-09-08T08:00:00.000Z", end: "2026-09-08T09:00:00.000Z" }
    ]
  });

  assert.ok(slot);
  assert.equal(slot.start.toISOString(), "2026-09-08T09:00:00.000Z");
  assert.equal(slot.end.toISOString(), "2026-09-08T11:00:00.000Z");
});

test("calendar/capacity resolution remains non-mutating and returns calculated dates only", () => {
  const calendarSnapshot = JSON.stringify(layers);
  resolveCapacitySlot({
    calendar_layers: layers,
    anchor: "2026-09-08T08:00:00.000Z",
    duration_minutes: 60,
    direction: "FORWARD",
    reservations: []
  });
  assert.equal(JSON.stringify(layers), calendarSnapshot);
});
