import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeFlowStep,
  normalizeFlowSteps,
  readSelectedFlowStepId,
  resolveInitialFlowStep,
} from "../src/components/primitives/flowStepModel.js";

test("normalizes bounded metadata-driven steps", () => {
  const steps = normalizeFlowSteps([
    { id: "identity", label: "Identity", status: "complete" },
    { id: "security", label: "Security", status: "warning", optional: true },
    { id: "security", label: "Duplicate" },
    { id: "__proto__", label: "Unsafe" },
  ]);

  assert.deepEqual(
    steps.map((step) => ({ id: step.id, status: step.status, optional: step.optional })),
    [
      { id: "identity", status: "complete", optional: false },
      { id: "security", status: "warning", optional: true },
    ]
  );
});

test("disabled steps remain disabled regardless of supplied status", () => {
  const step = normalizeFlowStep({
    id: "routing",
    label: "Routing",
    status: "complete",
    disabled: true,
  });

  assert.equal(step.status, "disabled");
  assert.equal(step.disabled, true);
});

test("initial selection prefers requested, then default, then first enabled", () => {
  const steps = normalizeFlowSteps([
    { id: "identity", label: "Identity" },
    { id: "security", label: "Security", disabled: true },
    { id: "routing", label: "Routing" },
  ]);

  assert.equal(resolveInitialFlowStep(steps, "routing", "identity")?.id, "routing");
  assert.equal(resolveInitialFlowStep(steps, "missing", "identity")?.id, "identity");
  assert.equal(resolveInitialFlowStep(steps, "security", "missing")?.id, "identity");
});

test("reads selected step identifiers without introducing domain state", () => {
  assert.equal(readSelectedFlowStepId("identity"), "identity");
  assert.equal(readSelectedFlowStepId({ id: "routing" }), "routing");
  assert.equal(readSelectedFlowStepId({ step_id: "audit" }), "audit");
  assert.equal(readSelectedFlowStepId(null), "");
});
