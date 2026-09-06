#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const engine = read("services/api/src/core/core_process_engine.js");
const canon = read("docs/architecture/EFFECT_LIBRARY_PRIMITIVE_V1.md");
const migration = read("db/migrations/v2_0038_effect_library_primitive_v1_freeze.sql");

const canonical = [
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

const forbidden = [
  "INVENTORY_MOVE",
  "INVENTORY_CONSUME",
  "INVENTORY_PRODUCE",
  "INVENTORY_CONVERT",
  "VARIANT_INVENTORY_VALIDATE",
  "JSON_MERGE",
  "HTTP_REQUEST",
  "API_CALL"
];

const registryMatch = engine.match(/const EFFECT_HANDLER_REGISTRY = \{([\s\S]*?)\n\};/);
if (!registryMatch) throw new Error("EFFECT_REGISTRY_MISSING");
const registry = registryMatch[1];

const failures = [];
for (const code of canonical) {
  if (!new RegExp(`\\b${code}\\b`).test(registry)) failures.push(`registry missing ${code}`);
  if (!new RegExp(`\\b${code}\\b`).test(canon)) failures.push(`canon missing ${code}`);
}
for (const code of forbidden) {
  if (new RegExp(`\\b${code}\\b`).test(registry)) failures.push(`forbidden registry code ${code}`);
}

for (const required of [
  "primitive_v1_locked",
  "primitive_v1_frozen",
  "LINK_PATCH",
  "SERVICE_OBJECT_PATCH",
  "PRIMITIVE_EFFECT_V1_FORBIDDEN_ACTIVE"
]) {
  if (!migration.includes(required)) failures.push(`freeze migration missing ${required}`);
}

for (const required of [
  "EFFECT_TYPE_NOT_GOVERNED",
  "EFFECT_CANONICAL_NOT_GOVERNED",
  "EFFECT_HANDLER_NOT_FOUND",
  "EFFECT_FIELD_UNSUPPORTED",
  "patchServiceObjectAttrs",
  "patchObjectLinkAttrs"
]) {
  if (!engine.includes(required)) failures.push(`runtime fail-closed/capability marker missing ${required}`);
}

if (!canon.includes("EFFECT LIBRARY PRIMITIVE V1 — LOCKED")) {
  failures.push("canon is not marked LOCKED");
}
if (!canon.includes("Business growth must normally expand Process/Macro metadata, not the primitive library")) {
  failures.push("canon expansion gate missing");
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log("Effect Library Primitive V1 governance gate: PASS");
console.log(`Canonical runtime primitives: ${canonical.join(", ")}`);
