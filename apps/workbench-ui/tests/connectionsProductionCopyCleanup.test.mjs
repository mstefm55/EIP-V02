import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  here,
  "../../../db/migrations/v2_0058_connection_v1_serial_code_and_ui_copy_cleanup.sql"
);
const source = fs.readFileSync(migrationPath, "utf8");

test("Connections final surface hides the generated code until the draft exists", () => {
  assert.match(source, /fields\.field - 'create_preview' - 'help'/);
  assert.match(source, /'hide_on_create', true/);
  assert.match(source, /'read_only', true/);
  assert.match(source, /'immutable_after_create', true/);
  assert.match(source, /'Assigned automatically'/);
});

test("Connections final surface replaces implementation copy with concise product copy", () => {
  for (const expected of [
    "Create and manage connections for each tenant.",
    "Choose a tenant.",
    "Connection details.",
    "Direction and endpoints.",
    "Authentication and credentials.",
    "Retry, timeout and duplicate handling.",
    "Routing and data mapping.",
    "Test the connection and review its status.",
    "Logging and audit settings.",
  ]) {
    assert.ok(source.includes(expected), `missing final product copy: ${expected}`);
  }

  for (const removed of [
    "V1 naming protocol",
    "server-authorized",
    "tenant-scoped",
    "control plane",
    "write-only credentials",
    "server-side probe",
    "governed auth",
  ]) {
    assert.ok(
      source.includes(`surface_text LIKE '%${removed}%`),
      `final migration does not guard removal of technical UI copy: ${removed}`
    );
  }
});

test("Connections create screen removes activation and code implementation help", () => {
  assert.match(source, /WHEN fields\.field ->> 'key' = 'connection_code'/);
  assert.match(source, /fields\.field - 'create_preview' - 'help'/);
  assert.match(source, /WHEN fields\.field ->> 'key' = 'is_enabled'/);
  assert.match(source, /fields\.field - 'help'/);
  assert.match(source, /output := output #- '\{props,create_mode_message\}'/);
});
