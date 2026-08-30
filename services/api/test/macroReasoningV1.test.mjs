import test from "node:test";
import assert from "node:assert/strict";

import {
  collectMacroParentAttrPaths,
  executeMacroReasoning
} from "../src/core/reasoning/macroReasoning.js";

test("macro reasoning supports scalar and chained calculations", () => {
  const macro = {
    reasoning: [
      {
        as: "required_hours",
        expression: { op: "DIVIDE", args: [{ ref: "$parent.attrs.quantity" }, { ref: "$input.rate" }] }
      },
      {
        as: "required_minutes",
        expression: { op: "MULTIPLY", args: [{ ref: "$context.calc.required_hours" }, 60] }
      }
    ]
  };
  const result = executeMacroReasoning(macro, {
    parent: { attrs: { quantity: 10000 } },
    input: { rate: 500 }
  });
  assert.equal(result.calc.required_hours, 20);
  assert.equal(result.calc.required_minutes, 1200);
  assert.equal(result.audit.length, 2);
});

test("macro reference inspection discovers only required parent attrs", () => {
  const macro = {
    reasoning: [
      {
        as: "runtime",
        expression: {
          op: "DIVIDE",
          args: [{ ref: "$parent.attrs.quantity" }, { ref: "$parent.attrs.production.rate" }]
        }
      }
    ]
  };
  assert.deepEqual(collectMacroParentAttrPaths(macro), ["production.rate", "quantity"]);
});

test("domain-specific operator is rejected", () => {
  const macro = {
    reasoning: [{ as: "plan", expression: { op: "MTO_PLAN", args: [1] } }]
  };
  assert.throws(() => executeMacroReasoning(macro), /REASONING_OPERATOR_NOT_ALLOWED:MTO_PLAN/);
});

test("duplicate calculation keys are rejected", () => {
  const macro = {
    reasoning: [
      { as: "x", expression: 1 },
      { as: "x", expression: 2 }
    ]
  };
  assert.throws(() => executeMacroReasoning(macro), /MACRO_REASONING_DUPLICATE_KEY:x/);
});
