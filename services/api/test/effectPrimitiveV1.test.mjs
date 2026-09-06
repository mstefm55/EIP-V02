import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const enginePath = path.join(here, "../src/core/core_process_engine.js");
const migrationPath = path.join(repoRoot, "db/migrations/v2_0036_primitive_effect_library_v1.sql");
const canonPath = path.join(repoRoot, "docs/architecture/EFFECT_LIBRARY_PRIMITIVE_V1.md");

const CANONICAL_OBJECT_EFFECTS = [
  "SERVICE_OBJECT_CREATE",
  "SERVICE_OBJECT_PATCH",
  "SERVICE_OBJECT_STATE_TRANSITION",
  "TASK_CREATE",
  "TASK_PATCH",
  "TASK_STATE_TRANSITION",
  "LINK_CREATE",
  "LINK_REMOVE",
  "INFO_RECORD_CREATE",
  "PROCESS_START",
  "ACCESS_GRANT_CREATE",
  "ACCESS_GRANT_PATCH"
];

const REJECTED_BUSINESS_EFFECTS = [
  "INVENTORY_MOVE",
  "INVENTORY_CONSUME",
  "INVENTORY_PRODUCE",
  "INVENTORY_CONVERT",
  "VARIANT_INVENTORY_VALIDATE"
];

test("Effect Library Primitive V1 canon explicitly admits the locked generic vocabulary", async () => {
  const source = await readFile(canonPath, "utf8");
  for (const code of CANONICAL_OBJECT_EFFECTS) {
    assert.match(source, new RegExp(`\\b${code}\\b`));
  }
  assert.match(source, /Business growth must normally expand Process\/Macro metadata, not the primitive library/);
});

test("v2_0036 admits canonical primitive identities and retires inventory business effects", async () => {
  const source = await readFile(migrationPath, "utf8");

  for (const code of CANONICAL_OBJECT_EFFECTS) {
    assert.match(source, new RegExp(`'${code}'`));
  }
  for (const code of REJECTED_BUSINESS_EFFECTS) {
    assert.match(source, new RegExp(`'${code}'`));
  }

  assert.match(source, /forbidden_as_primitive/);
  assert.match(source, /replacement_layer', 'process_macro_reasoning/);
  assert.match(source, /SET is_active = false/);
  assert.match(source, /PRIMITIVE_EFFECT_TAXONOMY_CONFLICT/);
});

test("primitive taxonomy migration is forward metadata repair with no new tables", async () => {
  const source = await readFile(migrationPath, "utf8");
  assert.doesNotMatch(source, /\bCREATE\s+TABLE\b/i);
  assert.doesNotMatch(source, /\bALTER\s+TABLE\b/i);
  assert.match(source, /PROCESS_EFFECT_TYPE/);
  assert.match(source, /process_def\.graph\.macros\.\*\.effects/);
});

test("SERVICE_OBJECT_PATCH is bounded to Service Object patch semantics", async () => {
  const source = await readFile(migrationPath, "utf8");
  assert.match(source, /'SERVICE_OBJECT_PATCH'/);
  assert.match(source, /'operations', jsonb_build_array\('SET', 'REMOVE'\)/);
  assert.match(source, /'mutation_scope', jsonb_build_array\('attrs'\)/);
  assert.match(source, /'reasoning_inside_handler', false/);
});

test("legacy names are explicitly compatibility-only rather than a second public catalogue", async () => {
  const source = await readFile(migrationPath, "utf8");
  assert.match(source, /compatibility_alias_only/);
  assert.match(source, /public_primitive_authority', false/);
  assert.match(source, /'SO_UPDATE',\s+'SERVICE_OBJECT_PATCH'/);
  assert.match(source, /'SO_CREATE',\s+'SERVICE_OBJECT_CREATE'/);
  assert.match(source, /'TASK_STATUS',\s+'TASK_STATE_TRANSITION'/);
});

test("unknown/inactive effect dispatch remains fail closed in the Process Engine", async () => {
  const source = await readFile(enginePath, "utf8");
  assert.match(source, /EFFECT_TYPE_NOT_GOVERNED/);
  assert.match(source, /requested\.is_active !== true/);
  assert.match(source, /EFFECT_CANONICAL_NOT_GOVERNED/);
  assert.match(source, /EFFECT_HANDLER_NOT_FOUND/);
});

test("HTTP request is classified outside Object_Effect Primitive V1", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const canon = await readFile(canonPath, "utf8");
  assert.match(migration, /'semantic_class', 'integration_capability'/);
  assert.match(migration, /'object_effect', false/);
  assert.match(canon, /`HTTP_REQUEST` is not part of Object_Effect Primitive V1/);
});
