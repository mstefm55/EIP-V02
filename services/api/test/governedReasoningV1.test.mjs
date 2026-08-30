import test from "node:test";
import assert from "node:assert/strict";

import { runGovernedReasoningOperator } from "../src/core/reasoning/governedReasoningOperators.js";
import {
  evaluateReasoningExpression,
  executeGovernedReasoningProgram
} from "../src/core/reasoning/governedReasoningRuntime.js";

function runtime() {
  return {
    limits: {
      maxDepth: 32,
      maxSteps: 50000,
      maxIterations: 10000,
      maxEmits: 10000,
      maxCollectionSize: 20000
    },
    steps: 0,
    outputs: []
  };
}

test("scalar operators remain domain-neutral and deterministic", () => {
  assert.equal(runGovernedReasoningOperator("ADD", [10, 20, 5]), 35);
  assert.equal(runGovernedReasoningOperator("DIVIDE", [10000, 500]), 20);
  assert.equal(runGovernedReasoningOperator("GTE", [8, 8]), true);
  assert.equal(runGovernedReasoningOperator("COUNT", [[1, 2, 3]]), 3);
});

test("lazy IF does not evaluate the unused branch", () => {
  const result = evaluateReasoningExpression(
    {
      special: "IF",
      condition: true,
      then: 7,
      else: { op: "DIVIDE", args: [1, 0] }
    },
    {},
    runtime()
  );
  assert.equal(result, 7);
});

test("FILTER + SORT_BY select a capable nearest resource without domain operator", () => {
  const resources = [
    { id: "A", capacity: 500, distance: 12, available: true },
    { id: "B", capacity: 1200, distance: 25, available: true },
    { id: "C", capacity: 900, distance: 8, available: true },
    { id: "D", capacity: 2000, distance: 5, available: false }
  ];

  const scope = { input: { resources, required: 800 } };
  const sorted = evaluateReasoningExpression(
    {
      special: "SORT_BY",
      source: {
        special: "FILTER",
        source: { ref: "$input.resources" },
        where: {
          op: "AND",
          args: [
            { ref: "$item.available" },
            { op: "GTE", args: [{ ref: "$item.capacity" }, { ref: "$input.required" }] }
          ]
        }
      },
      by: { ref: "$item.distance" },
      direction: "ASC"
    },
    scope,
    runtime()
  );

  assert.deepEqual(sorted.map((row) => row.id), ["C", "B"]);
});

test("generic program decomposes quantity without batch-specific operator", () => {
  const program = {
    steps: [
      { set: "remaining", value: { ref: "$parent.attrs.quantity" } },
      { set: "index", value: 0 },
      {
        while: { op: "GT", args: [{ ref: "$remaining" }, 0] },
        max_iterations: 1000,
        do: [
          {
            set: "requested",
            value: {
              op: "GET",
              args: [
                { ref: "$policy.sequence" },
                {
                  op: "MOD",
                  args: [
                    { ref: "$index" },
                    { op: "COUNT", args: [{ ref: "$policy.sequence" }] }
                  ]
                }
              ]
            }
          },
          {
            set: "quantity",
            value: { op: "MIN", args: [{ ref: "$requested" }, { ref: "$remaining" }] }
          },
          { emit: { quantity: { ref: "$quantity" } } },
          {
            set: "remaining",
            value: { op: "SUBTRACT", args: [{ ref: "$remaining" }, { ref: "$quantity" }] }
          },
          { set: "index", value: { op: "ADD", args: [{ ref: "$index" }, 1] } }
        ]
      }
    ]
  };

  const result = executeGovernedReasoningProgram(program, {
    parent: { attrs: { quantity: 10000 } },
    policy: { sequence: [400, 200, 100, 500] }
  });

  assert.equal(result.outputs.reduce((sum, row) => sum + row.quantity, 0), 10000);
  assert.deepEqual(result.outputs.slice(0, 4).map((row) => row.quantity), [400, 200, 100, 500]);
  assert.equal(result.outputs.length, 33);
});

test("unknown operators fail closed", () => {
  assert.throws(
    () => runGovernedReasoningOperator("SELECT_TRUCK", []),
    /REASONING_OPERATOR_NOT_ALLOWED/
  );
});

test("unsafe reference paths fail closed", () => {
  assert.throws(
    () => evaluateReasoningExpression({ ref: "$input.__proto__.polluted" }, { input: {} }, runtime()),
    /REASONING_REFERENCE_FORBIDDEN/
  );
});

test("loop execution is bounded", () => {
  const program = {
    limits: { maxIterations: 3 },
    steps: [
      { set: "x", value: 1 },
      { while: true, do: [{ set: "x", value: { op: "ADD", args: [{ ref: "$x" }, 1] } }] }
    ]
  };

  assert.throws(
    () => executeGovernedReasoningProgram(program),
    /REASONING_ITERATION_LIMIT_EXCEEDED/
  );
});
