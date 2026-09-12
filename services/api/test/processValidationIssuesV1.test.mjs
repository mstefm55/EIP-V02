import assert from "node:assert/strict";
import test from "node:test";

import {
  projectProcessValidationIssue,
  projectProcessValidationIssues,
} from "../src/services/process/processValidationIssues.js";

test("validation issue projection preserves canonical code and raw evidence", () => {
  assert.deepEqual(
    projectProcessValidationIssue("TRANSITION_MACRO_REQUIRED:review"),
    {
      code: "TRANSITION_MACRO_REQUIRED",
      location: "transition:review",
      details: ["review"],
      message: "Select a macro for this transition.",
      raw: "TRANSITION_MACRO_REQUIRED:review",
    }
  );
});

test("macro effect issues map to the macro location", () => {
  const issue = projectProcessValidationIssue(
    "EFFECT_FIELD_REQUIRED:macro:APPROVE_ORDER:to"
  );
  assert.equal(issue.code, "EFFECT_FIELD_REQUIRED");
  assert.equal(issue.location, "macro:APPROVE_ORDER");
  assert.deepEqual(issue.details, ["macro", "APPROVE_ORDER", "to"]);
});

test("graph and task-template failures receive stable locations", () => {
  const issues = projectProcessValidationIssues([
    "INITIAL_NODE_REQUIRED",
    "HUMAN_TASK_MISSING_TEMPLATE:approve_order",
    "TASK_TEMPLATE_MISSING:approve_order:APPROVAL",
  ]);

  assert.deepEqual(
    issues.map(({ code, location }) => ({ code, location })),
    [
      { code: "INITIAL_NODE_REQUIRED", location: "graph" },
      { code: "HUMAN_TASK_MISSING_TEMPLATE", location: "node:approve_order" },
      { code: "TASK_TEMPLATE_MISSING", location: "node:approve_order" },
    ]
  );
});

test("empty validation entries are omitted", () => {
  assert.deepEqual(projectProcessValidationIssues(["", null, undefined]), []);
});
