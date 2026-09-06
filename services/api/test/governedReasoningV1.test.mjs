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

test("scalar arithmetic transformation operators remain domain-neutral and deterministic", () => {
  assert.equal(runGovernedReasoningOperator("ADD", [10, 20, 5]), 35);
  assert.equal(runGovernedReasoningOperator("SUBTRACT", [20, 7]), 13);
  assert.equal(runGovernedReasoningOperator("MULTIPLY", [4, 5, 2]), 40);
  assert.equal(runGovernedReasoningOperator("DIVIDE", [10000, 500]), 20);
  assert.equal(runGovernedReasoningOperator("MOD", [17, 5]), 2);
  assert.equal(runGovernedReasoningOperator("MIN", [9, 3, 7]), 3);
  assert.equal(runGovernedReasoningOperator("MAX", [9, 3, 7]), 9);
  assert.equal(runGovernedReasoningOperator("ABS", [-12]), 12);
  assert.equal(runGovernedReasoningOperator("ROUND", [2.6]), 3);
  assert.equal(runGovernedReasoningOperator("FLOOR", [2.9]), 2);
  assert.equal(runGovernedReasoningOperator("CEIL", [2.1]), 3);
});

test("comparison, boolean and collection operators remain primitive", () => {
  assert.equal(runGovernedReasoningOperator("EQ", ["A", "A"]), true);
  assert.equal(runGovernedReasoningOperator("NE", ["A", "B"]), true);
  assert.equal(runGovernedReasoningOperator("GT", [9, 8]), true);
  assert.equal(runGovernedReasoningOperator("GTE", [8, 8]), true);
  assert.equal(runGovernedReasoningOperator("LT", [7, 8]), true);
  assert.equal(runGovernedReasoningOperator("LTE", [8, 8]), true);
  assert.equal(runGovernedReasoningOperator("AND", [true, true, 1]), true);
  assert.equal(runGovernedReasoningOperator("OR", [false, 0, true]), true);
  assert.equal(runGovernedReasoningOperator("NOT", [false]), true);
  assert.equal(runGovernedReasoningOperator("COALESCE", [null, undefined, 4]), 4);
  assert.equal(runGovernedReasoningOperator("COUNT", [[1, 2, 3]]), 3);
  assert.equal(runGovernedReasoningOperator("SUM", [[1, 2, 3]]), 6);
  assert.equal(runGovernedReasoningOperator("FIRST", [[7, 8, 9]]), 7);
  assert.equal(runGovernedReasoningOperator("LAST", [[7, 8, 9]]), 9);
  assert.equal(runGovernedReasoningOperator("GET", [[7, 8, 9], 1]), 8);
});

test("invalid numeric transformations fail closed", () => {
  assert.throws(
    () => runGovernedReasoningOperator("DIVIDE", [1, 0]),
    /REASONING_DIVIDE_BY_ZERO/
  );
  assert.throws(
    () => runGovernedReasoningOperator("MOD", [1, 0]),
    /REASONING_MOD_BY_ZERO/
  );
  assert.throws(
    () => runGovernedReasoningOperator("MULTIPLY", [2, "not-a-number"]),
    /REASONING_NUMBER_REQUIRED/
  );
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
