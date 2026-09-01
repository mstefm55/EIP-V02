import test from "node:test";
import assert from "node:assert/strict";

import {
  clearSelectionTarget,
  clearSelections,
  createSelectionState,
  normalizeSelectionTarget,
  readSelectionDetail,
  readSelectionTarget,
  setSelectionDetail,
  setSelectionTarget,
} from "../src/engine/selectionModel.js";

test("selection targets are normalized and bounded", () => {
  assert.equal(normalizeSelectionTarget(" Schedule_Step "), "schedule_step");
  assert.equal(normalizeSelectionTarget("asset:machine"), "asset:machine");
  assert.equal(normalizeSelectionTarget("__proto__"), null);
  assert.equal(normalizeSelectionTarget("bad target"), null);
  assert.equal(normalizeSelectionTarget("9invalid"), null);
});

test("generic targets preserve independent selections", () => {
  let state = createSelectionState();
  state = setSelectionTarget(state, "definition", { id: "process-1" });
  state = setSelectionTarget(state, "schedule_step", { id: "so-1:cut" });

  assert.deepEqual(readSelectionTarget(state, "definition"), { id: "process-1" });
  assert.deepEqual(readSelectionTarget(state, "schedule_step"), { id: "so-1:cut" });
});

test("changing a target clears only that target detail", () => {
  let state = createSelectionState();
  state = setSelectionTarget(state, "schedule_step", { id: "one" });
  state = setSelectionDetail(state, "schedule_step", { loaded: true });
  state = setSelectionTarget(state, "definition", { id: "process" });
  state = setSelectionDetail(state, "definition", { loaded: true });
  state = setSelectionTarget(state, "schedule_step", { id: "two" });

  assert.equal(readSelectionDetail(state, "schedule_step"), null);
  assert.deepEqual(readSelectionDetail(state, "definition"), { loaded: true });
});

test("clear target and clear all do not leak stale selection", () => {
  let state = createSelectionState();
  state = setSelectionTarget(state, "asset", { id: "asset-1" });
  state = setSelectionTarget(state, "material", { id: "material-1" });
  state = clearSelectionTarget(state, "asset");

  assert.equal(readSelectionTarget(state, "asset"), null);
  assert.deepEqual(readSelectionTarget(state, "material"), { id: "material-1" });

  state = clearSelections();
  assert.equal(readSelectionTarget(state, "material"), null);
});

test("invalid selection targets fail closed on writes", () => {
  assert.throws(
    () => setSelectionTarget(createSelectionState(), "bad target", { id: "x" }),
    /UI_SELECTION_TARGET_INVALID/
  );
  assert.throws(
    () => clearSelectionTarget(createSelectionState(), "constructor"),
    /UI_SELECTION_TARGET_INVALID/
  );
});
