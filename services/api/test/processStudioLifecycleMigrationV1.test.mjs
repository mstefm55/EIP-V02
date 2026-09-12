import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  here,
  "../../../db/migrations/v2_0063_process_definition_lifecycle_governance.sql"
);

async function migrationSql() {
  return readFile(migrationPath, "utf8");
}

test("v2_0063 introduces lifecycle governance without new feature tables", async () => {
  const sql = await migrationSql();
  assert.match(sql, /process_def_lifecycle_status_ck/i);
  assert.match(sql, /process_definition_lifecycle_v1_trg/i);
  assert.match(sql, /task_template_process_draft_v1_trg/i);
  assert.match(sql, /process_binding_published_target_v1_trg/i);
  assert.match(sql, /process_instance_published_def_v1_trg/i);
  assert.match(sql, /activate_revision_bindings_on_publish_v1/i);
  assert.doesNotMatch(sql, /CREATE\s+TABLE\s+/i);
});

test("v2_0063 protects published runtime and published template immutability", async () => {
  const sql = await migrationSql();
  assert.match(sql, /PROCESS_DEF_PUBLISHED_IMMUTABLE/);
  assert.match(sql, /PROCESS_DEF_ARCHIVED_IMMUTABLE/);
  assert.match(sql, /PROCESS_DEF_NOT_PUBLISHED/);
  assert.match(sql, /PROCESS_BINDING_TARGET_NOT_PUBLISHED/);
  assert.match(sql, /lifecycle_status[^\n]*'draft'|lifecycle_status/);
  assert.match(sql, /'published'/);
  assert.match(sql, /'archived'/);
});

test("v2_0063 preserves legacy deployed definitions before enforcing the new lifecycle", async () => {
  const sql = await migrationSql();
  assert.match(sql, /FROM eip_core\.process_binding pb/);
  assert.match(sql, /pb\.is_active = true/);
  assert.match(sql, /FROM eip_core\.process_instance pi/);
});
