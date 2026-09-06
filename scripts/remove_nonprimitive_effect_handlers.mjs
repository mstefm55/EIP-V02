#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enginePath = path.join(root, "services/api/src/core/core_process_engine.js");
let source = fs.readFileSync(enginePath, "utf8");

function removeRange(label, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) {
    console.log(`already removed: ${label}`);
    return;
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`REMOVE_END_NOT_FOUND:${label}`);
  source = source.slice(0, start) + source.slice(end);
  console.log(`removed: ${label}`);
}

function removeExact(label, text) {
  const first = source.indexOf(text);
  if (first === -1) {
    console.log(`already removed: ${label}`);
    return;
  }
  if (source.indexOf(text, first + text.length) !== -1) {
    throw new Error(`REMOVE_TARGET_NOT_UNIQUE:${label}`);
  }
  source = source.slice(0, first) + source.slice(first + text.length);
  console.log(`removed: ${label}`);
}

function replaceExact(label, before, after) {
  const first = source.indexOf(before);
  if (first === -1) {
    if (source.includes(after)) {
      console.log(`already replaced: ${label}`);
      return;
    }
    throw new Error(`REPLACE_TARGET_NOT_FOUND:${label}`);
  }
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`REPLACE_TARGET_NOT_UNIQUE:${label}`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
  console.log(`replaced: ${label}`);
}

removeExact(
  "material lot status constant",
  'const MATERIAL_LOT_STATUS_LIST_CODE = "MATERIAL_LOT_STATUS";\n'
);

removeRange(
  "inventory normalization helpers",
  'function normalizeLocation(value) {',
  'const EFFECT_HANDLER_REGISTRY = {'
);

removeRange(
  "material lot resolver helper",
  'async function resolveMaterialLotRow(client, tenantId, params) {',
  'async function insertInfoRecord(client, ctx, input) {'
);

removeRange(
  "material lot status event helper",
  'async function writeMaterialLotStatusEvent(client, ctx, input) {',
  'async function validateStatus(client, tenantId, listCode, statusCode) {'
);

removeRange(
  "variant and inventory business Effect handlers",
  '    if (type === "VARIANT_INVENTORY_VALIDATE") {',
  '    if (type === "SERVICE_OBJECT_PATCH" || type === "SO_UPDATE") {'
);

removeRange(
  "broad JSON merge Effect handler",
  '    if (type === "JSON_MERGE") {',
  '    if (type === "INFO_RECORD_CREATE" || type === "INFO_RECORD_WRITE") {'
);

replaceExact(
  "TASK_CREATE temporal resolution",
`      let dueAt = normalizeOptionalText(resolveDynamicValue(effect?.due_at, ctx, payload));
      const dueInDays = Number(resolveDynamicValue(effect?.due_in_days, ctx, payload));
      if (!dueAt && Number.isFinite(dueInDays)) {
        // Legacy compatibility only. Canonical TASK_CREATE metadata no longer admits
        // due_in_days; callers must resolve working/calendar time before mutation.
        dueAt = new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000).toISOString();
      }`,
`      const dueAt = normalizeOptionalText(resolveDynamicValue(effect?.due_at, ctx, payload));`
);

fs.writeFileSync(enginePath, source);
console.log(`updated ${path.relative(root, enginePath)}`);
