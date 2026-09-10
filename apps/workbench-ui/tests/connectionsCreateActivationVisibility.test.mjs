import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("generic step editor hides metadata fields only while creating", () => {
  const source = read("apps/workbench-ui/src/components/primitives/ContractFlowStepEditor.jsx");

  assert.match(source, /createMode && field\.hide_on_create/);
  assert.match(source, /validateStepEditorDraft\(draft, fields, \{ isCreate: createMode \}\)/);
});

test("connection metadata hides Enabled during draft creation and restores it after persistence", () => {
  const migration = read("db/migrations/v2_0056_connection_activation_visibility.sql");

  assert.match(migration, /'hide_on_create', true/);
  assert.match(migration, /'default_value', false/);
  assert.match(migration, /fields\.field - 'disabled_on_create'/);
  assert.match(migration, /Activation is available after the disabled draft is created/);
  // The migration must actively fail if browser-owned tenant_id metadata appears
  // on the rendered surface; this guard is evidence of tenant safety, not a leak.
  assert.match(migration, /surface_tree::text LIKE '%\"tenant_id\"%'/);
});
