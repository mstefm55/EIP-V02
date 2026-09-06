import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const enginePath = path.join(here, "../src/core/core_process_engine.js");
const migration36Path = path.join(repoRoot, "db/migrations/v2_0036_primitive_effect_library_v1.sql");
const migration38Path = path.join(repoRoot, "db/migrations/v2_0038_effect_library_primitive_v1_freeze.sql");
const canonPath = path.join(repoRoot, "docs/architecture/EFFECT_LIBRARY_PRIMITIVE_V1.md");

const CANONICAL_OBJECT_EFFECTS = [
  "SERVICE_OBJECT_CREATE",
  "SERVICE_OBJECT_PATCH",
  "SERVICE_OBJECT_STATE_TRANSITION",
  "TASK_CREATE",
  "TASK_PATCH",
  "TASK_STATE_TRANSITION",
  "LINK_CREATE",
  "LINK_PATCH",
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

function registryBlock(source) {
  const match = source.match(/const EFFECT_HANDLER_REGISTRY = \{([\s\S]*?)\n\};/);
  assert.ok(match, "Effect handler registry must exist");
  return match[1];
}

test("Effect Library Primitive V1 canon explicitly admits the locked generic vocabulary", async () => {
  const source = await readFile(canonPath, "utf8");
  for (const code of CANONICAL_OBJECT_EFFECTS) {
    assert.match(source, new RegExp(`\\b${code}\\b`));
  }
  assert.match(source, /EFFECT LIBRARY PRIMITIVE V1 — LOCKED/);
  assert.match(source, /Business growth must normally expand Process\/Macro metadata, not the primitive library/);
});

test("v2_0036 establishes canonical primitives and retires inventory business effects", async () => {
  const source = await readFile(migration36Path, "utf8");
  for (const code of REJECTED_BUSINESS_EFFECTS) assert.match(source, new RegExp(`'${code}'`));
  assert.match(source, /forbidden_as_primitive/);
  assert.match(source, /replacement_layer', 'process_macro_reasoning/);
  assert.match(source, /SET is_active = false/);
  assert.match(source, /PRIMITIVE_EFFECT_TAXONOMY_CONFLICT/);
});

test("v2_0038 forward-freezes SERVICE_OBJECT_PATCH and LINK_PATCH without schema expansion", async () => {
  const source = await readFile(migration38Path, "utf8");
  assert.match(source, /'SERVICE_OBJECT_PATCH'/);
  assert.match(source, /'LINK_PATCH'/);
  assert.match(source, /primitive_v1_frozen/);
  assert.match(source, /primitive_v1_freeze_migration', 'v2_0038'/);
  assert.doesNotMatch(source, /\bCREATE\s+TABLE\b/i);
  assert.doesNotMatch(source, /\bALTER\s+TABLE\b/i);
});

test("SERVICE_OBJECT_PATCH owns bounded non-lifecycle Service Object mutation", async () => {
  const migration = await readFile(migration38Path, "utf8");
  const engine = await readFile(enginePath, "utf8");

  assert.match(migration, /service_object_id.*code.*title.*owner_agent_id.*patches/s);
  assert.match(migration, /service_object\.code/);
  assert.match(migration, /service_object\.title/);
  assert.match(migration, /service_object\.owner_agent_id/);
  assert.match(migration, /service_object\.attrs/);
  assert.match(migration, /'state_mutation_allowed', false/);

  assert.match(engine, /SERVICE_OBJECT_PATCH_EMPTY/);
  assert.match(engine, /SERVICE_OBJECT_PATCH_ATTRS_MERGE_UNSUPPORTED/);
  assert.match(engine, /patchServiceObjectAttrs/);
  assert.match(engine, /owner_agent_id/);
  assert.doesNotMatch(engine, /SERVICE_OBJECT_PATCH[\s\S]{0,700}SET status/);
});

test("LINK_PATCH is bounded to Object Link attrs and cannot mutate relationship identity", async () => {
  const migration = await readFile(migration38Path, "utf8");
  const engine = await readFile(enginePath, "utf8");

  assert.match(migration, /'LINK_PATCH'/);
  assert.match(migration, /'mutation_scope', '\["object_link\.attrs"\]'::jsonb/);
  assert.match(migration, /'identity_mutation_allowed', false/);
  assert.match(migration, /src_kind.*src_id.*dst_kind.*dst_id.*relation_type.*patches/s);
  assert.match(engine, /LINK_PATCH: "linkPatch"/);
  assert.match(engine, /patchObjectLinkAttrs/);
});

test("runtime registry admits canonical primitives and excludes business/integration effects", async () => {
  const source = await readFile(enginePath, "utf8");
  const registry = registryBlock(source);
  for (const code of CANONICAL_OBJECT_EFFECTS) {
    assert.match(registry, new RegExp(`\\b${code}\\b`));
  }
  for (const code of REJECTED_BUSINESS_EFFECTS) {
    assert.doesNotMatch(registry, new RegExp(`\\b${code}\\b`));
  }
  assert.doesNotMatch(registry, /\bJSON_MERGE\b/);
  assert.doesNotMatch(registry, /\bHTTP_REQUEST\b/);
  assert.doesNotMatch(registry, /\bAPI_CALL\b/);
});

test("canonical runtime contracts fail closed on unsupported parameters", async () => {
  const source = await readFile(enginePath, "utf8");
  assert.match(source, /validateGovernedEffectRuntimeContract/);
  assert.match(source, /EFFECT_FIELD_UNSUPPORTED/);
  assert.match(source, /SERVICE_OBJECT_CREATE_ITEMS_UNSUPPORTED/);
  assert.match(source, /SERVICE_OBJECT_CREATE_LINKS_UNSUPPORTED/);
  assert.match(source, /TASK_PATCH_STATE_UNSUPPORTED/);
  assert.match(source, /TASK_STATE_TRANSITION_FIELD_UNSUPPORTED/);
  assert.match(source, /INFO_RECORD_CREATE_LINKS_UNSUPPORTED/);
});

test("legacy names remain compatibility-only rather than a second public catalogue", async () => {
  const source = await readFile(migration36Path, "utf8");
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

test("HTTP request remains outside Object_Effect Primitive V1 authority", async () => {
  const migration36 = await readFile(migration36Path, "utf8");
  const migration38 = await readFile(migration38Path, "utf8");
  const canon = await readFile(canonPath, "utf8");
  const engine = await readFile(enginePath, "utf8");

  assert.match(migration36, /'semantic_class', 'integration_capability'/);
  assert.match(migration36, /'object_effect', false/);
  assert.match(migration38, /'HTTP_REQUEST'/);
  assert.match(canon, /`HTTP_REQUEST` is not part of Object_Effect Primitive V1/);
  assert.doesNotMatch(registryBlock(engine), /\bHTTP_REQUEST\b/);
});
