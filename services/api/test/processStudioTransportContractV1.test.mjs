import assert from "node:assert/strict";
import test from "node:test";

import {
  PROCESS_STUDIO_CONTRACT_VERSION,
  PROCESS_STUDIO_TRANSPORT_V1,
  getProcessStudioOperation,
  listProcessStudioOperations,
} from "../src/services/process/processStudioTransportContract.js";

test("Process Studio transport contract is session-tenant authoritative", () => {
  assert.equal(PROCESS_STUDIO_CONTRACT_VERSION, "process-studio-v1");
  assert.equal(PROCESS_STUDIO_TRANSPORT_V1.tenant_authority, "session");
  assert.equal(PROCESS_STUDIO_TRANSPORT_V1.raw_tenant_id_allowed, false);

  for (const entry of Object.values(PROCESS_STUDIO_TRANSPORT_V1.operations)) {
    assert.equal(entry.tenant_authority, "session");
    assert.equal(entry.path.includes("tenant_id"), false);
  }
});

test("implemented adapter surface covers library, process and operator workflows", () => {
  const operations = listProcessStudioOperations();
  const studios = new Set(operations.map((entry) => entry.studio));

  assert.equal(studios.has("library"), true);
  assert.equal(studios.has("process"), true);
  assert.equal(studios.has("operator"), true);

  for (const code of [
    "list_processes",
    "get_process",
    "create_process_draft",
    "update_process_draft",
    "validate_process",
    "publish_process",
    "list_task_templates",
    "list_bindings",
    "list_instances",
    "get_instance",
    "start_process",
    "advance_process",
  ]) {
    const entry = getProcessStudioOperation(code);
    assert.ok(entry, `${code} is missing`);
    assert.equal(entry.implemented, true, `${code} must be implemented`);
  }
});

test("draft revision operation is explicit but not falsely advertised as implemented", () => {
  const operation = getProcessStudioOperation("create_draft_revision");
  assert.ok(operation);
  assert.equal(operation.implemented, false);
  assert.equal(operation.lifecycle, "published-to-new-draft");

  assert.equal(
    listProcessStudioOperations().some((entry) => entry.code === "create_draft_revision"),
    false
  );
  assert.equal(
    listProcessStudioOperations({ includePlanned: true }).some(
      (entry) => entry.code === "create_draft_revision"
    ),
    true
  );
});

test("Process Studio writes remain permission-governed", () => {
  for (const code of [
    "create_process_draft",
    "update_process_draft",
    "publish_process",
    "create_task_template",
    "create_binding",
    "start_process",
    "advance_process",
  ]) {
    const entry = getProcessStudioOperation(code);
    assert.ok(entry.permission.length > 0, `${code} has no permission contract`);
    assert.ok(
      entry.permission.some((permission) => permission.endsWith("_WRITE")),
      `${code} must require a write permission`
    );
  }
});
