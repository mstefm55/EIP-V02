#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enginePath = path.join(root, "services/api/src/core/core_process_engine.js");
let source = fs.readFileSync(enginePath, "utf8");

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first === -1) {
    if (source.includes(after)) {
      console.log(`already applied: ${label}`);
      return;
    }
    throw new Error(`PATCH_TARGET_NOT_FOUND:${label}`);
  }
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`PATCH_TARGET_NOT_UNIQUE:${label}`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
  console.log(`applied: ${label}`);
}

replaceOnce(
  "effect registry",
`const EFFECT_HANDLER_REGISTRY = {
  CHILD_SERVICE_OBJECT_CREATE: "childServiceObjectCreate",
  STATUS_SET: "statusSet",
  SO_UPDATE: "serviceObjectUpdate",
  TASK_CREATE: "taskCreate",
  TASK_UPDATE: "taskUpdate",
  LINK_CREATE: "linkCreate",
  LINK_REMOVE: "linkRemove",
  JSON_MERGE: "jsonMerge",
  HTTP_REQUEST: "httpRequest",
  INFO_RECORD_WRITE: "infoRecordWrite",
  ACCESS_GRANT_CREATE: "accessGrantCreate",
  ACCESS_GRANT_UPDATE: "accessGrantUpdate",
  INSTANCE_START: "instanceStart",
  INVENTORY_MOVE: "inventoryMove",
  INVENTORY_CONSUME: "inventoryConsume",
  INVENTORY_PRODUCE: "inventoryProduce",
  INVENTORY_CONVERT: "inventoryConvert",
  VARIANT_INVENTORY_VALIDATE: "variantInventoryValidate"
};`,
`const EFFECT_HANDLER_REGISTRY = {
  SERVICE_OBJECT_CREATE: "serviceObjectCreate",
  SERVICE_OBJECT_PATCH: "serviceObjectPatch",
  SERVICE_OBJECT_STATE_TRANSITION: "serviceObjectStateTransition",
  TASK_CREATE: "taskCreate",
  TASK_PATCH: "taskPatch",
  TASK_STATE_TRANSITION: "taskStateTransition",
  LINK_CREATE: "linkCreate",
  LINK_REMOVE: "linkRemove",
  INFO_RECORD_CREATE: "infoRecordCreate",
  PROCESS_START: "processStart",
  ACCESS_GRANT_CREATE: "accessGrantCreate",
  ACCESS_GRANT_PATCH: "accessGrantPatch",
  HTTP_REQUEST: "httpRequest",

  // Temporary generic compatibility executable identities. These are not public
  // primitive authority; governed metadata marks them hidden/deprecated.
  CHILD_SERVICE_OBJECT_CREATE: "serviceObjectCreateLegacy",
  STATUS_SET: "stateTransitionLegacy",
  SO_UPDATE: "serviceObjectPatchLegacy",
  TASK_UPDATE: "taskPatchLegacy",
  INFO_RECORD_WRITE: "infoRecordCreateLegacy",
  ACCESS_GRANT_UPDATE: "accessGrantPatchLegacy",
  INSTANCE_START: "processStartLegacy"
};`
);

replaceOnce(
  "runtime contract helper",
`function getPayloadPath(payload, path) {`,
`const COMMON_EFFECT_CONTRACT_FIELDS = new Set([
  "type",
  "effect_instance",
  "service_object_type",
  "service_object_category",
  "object_type",
  "object_category"
]);

function validateGovernedEffectRuntimeContract(effectGovernanceMap, resolvedEffect, effect) {
  // Legacy compatibility aliases keep their historical contract until migrated.
  // Canonical public Effect identities fail closed on unsupported parameters.
  if (resolvedEffect.requested_code !== resolvedEffect.effect_code) return;
  const governance = effectGovernanceMap[resolvedEffect.effect_code];
  const attrs = governance?.attrs && typeof governance.attrs === "object" ? governance.attrs : {};
  const allowedFields = Array.isArray(attrs.allowed_fields) ? attrs.allowed_fields : null;
  if (!allowedFields || allowedFields.length === 0) return;
  const allowed = new Set(allowedFields.map((field) => String(field)));
  for (const key of Object.keys(effect || {})) {
    if (COMMON_EFFECT_CONTRACT_FIELDS.has(key) || allowed.has(key)) continue;
    throw new Error("EFFECT_FIELD_UNSUPPORTED:" + resolvedEffect.effect_code + ":" + key);
  }
}

function getPayloadPath(payload, path) {`
);

replaceOnce(
  "runtime contract invocation",
`    if (!EFFECT_HANDLER_REGISTRY[type]) {
      throw new Error(\`EFFECT_HANDLER_NOT_FOUND:${type}\`);
    }

    if (type === "CHILD_SERVICE_OBJECT_CREATE") {`,
`    if (!EFFECT_HANDLER_REGISTRY[type]) {
      throw new Error(\`EFFECT_HANDLER_NOT_FOUND:${type}\`);
    }
    validateGovernedEffectRuntimeContract(effectGovernanceMap, resolvedEffect, effect);

    if (type === "SERVICE_OBJECT_CREATE" || type === "CHILD_SERVICE_OBJECT_CREATE") {
      if (type === "SERVICE_OBJECT_CREATE") {
        if (Array.isArray(effect?.items)) throw new Error("SERVICE_OBJECT_CREATE_ITEMS_UNSUPPORTED");
        if (effect?.links || effect?.link) throw new Error("SERVICE_OBJECT_CREATE_LINKS_UNSUPPORTED");
      }`
);

replaceOnce(
  "state transition canonical split",
`    if (type === "STATUS_SET") {
      const target = normalizeOptionalText(effect?.target) || (effect?.task_id ? "task" : "service_object");`,
`    if (
      type === "SERVICE_OBJECT_STATE_TRANSITION" ||
      type === "TASK_STATE_TRANSITION" ||
      type === "STATUS_SET"
    ) {
      const target =
        type === "TASK_STATE_TRANSITION"
          ? "task"
          : type === "SERVICE_OBJECT_STATE_TRANSITION"
            ? "service_object"
            : normalizeOptionalText(effect?.target) || (effect?.task_id ? "task" : "service_object");`
);

replaceOnce(
  "service object patch canonical",
`    if (type === "SO_UPDATE") {
      const title = normalizeOptionalText(`,
`    if (type === "SERVICE_OBJECT_PATCH" || type === "SO_UPDATE") {
      const title = normalizeOptionalText(`
);

replaceOnce(
  "service object patch strict contract",
`      const serviceObjectId =
        normalizeOptionalText(resolveDynamicValue(effect?.service_object_id, ctx, payload)) ||
        ctx.serviceObjectId;

      if (!title && !attrs && !patches) throw new Error("SO_UPDATE_EMPTY");`,
`      const serviceObjectId =
        normalizeOptionalText(resolveDynamicValue(effect?.service_object_id, ctx, payload)) ||
        ctx.serviceObjectId;

      if (type === "SERVICE_OBJECT_PATCH" && (title || attrs || !patches)) {
        throw new Error("SERVICE_OBJECT_PATCH_REQUIRES_BOUNDED_PATCHES");
      }
      if (!title && !attrs && !patches) throw new Error("SO_UPDATE_EMPTY");`
);

replaceOnce(
  "task create resolved due at",
`      let dueAt = null;
      const dueInDays = Number(resolveDynamicValue(effect?.due_in_days, ctx, payload));
      if (Number.isFinite(dueInDays)) {
        dueAt = new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000).toISOString();
      }`,
`      let dueAt = normalizeOptionalText(resolveDynamicValue(effect?.due_at, ctx, payload));
      const dueInDays = Number(resolveDynamicValue(effect?.due_in_days, ctx, payload));
      if (!dueAt && Number.isFinite(dueInDays)) {
        // Legacy compatibility only. Canonical TASK_CREATE metadata no longer admits
        // due_in_days; callers must resolve working/calendar time before mutation.
        dueAt = new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000).toISOString();
      }`
);

replaceOnce(
  "task patch/state canonical",
`    if (type === "TASK_UPDATE") {
      const taskId = normalizeOptionalText(`,
`    if (type === "TASK_PATCH" || type === "TASK_STATE_TRANSITION" || type === "TASK_UPDATE") {
      if (type === "TASK_PATCH" && (effect?.to !== undefined || effect?.status !== undefined)) {
        throw new Error("TASK_PATCH_STATE_UNSUPPORTED");
      }
      if (type === "TASK_STATE_TRANSITION") {
        for (const field of ["title", "description", "assigned_agent_id", "due_at", "payload", "attrs"]) {
          if (effect?.[field] !== undefined) throw new Error("TASK_STATE_TRANSITION_FIELD_UNSUPPORTED:" + field);
        }
      }
      const taskId = normalizeOptionalText(`
);

replaceOnce(
  "task state required",
`      const toStatusRaw = resolveDynamicValue(effect?.to ?? effect?.status, ctx, payload);
      const toStatus = toStatusRaw ? normalizeStatus(toStatusRaw) : null;
      if (toStatus) {`,
`      const toStatusRaw = resolveDynamicValue(effect?.to ?? effect?.status, ctx, payload);
      const toStatus = toStatusRaw ? normalizeStatus(toStatusRaw) : null;
      if (type === "TASK_STATE_TRANSITION" && !toStatus) throw new Error("TASK_STATE_REQUIRED");
      if (toStatus) {`
);

replaceOnce(
  "info record canonical",
`    if (type === "INFO_RECORD_WRITE") {
      const recordType = normalizeOptionalText(`,
`    if (type === "INFO_RECORD_CREATE" || type === "INFO_RECORD_WRITE") {
      if (type === "INFO_RECORD_CREATE" && (effect?.links || effect?.link)) {
        throw new Error("INFO_RECORD_CREATE_LINKS_UNSUPPORTED");
      }
      const recordType = normalizeOptionalText(`
);

replaceOnce(
  "access grant patch canonical",
`    if (type === "ACCESS_GRANT_UPDATE") {`,
`    if (type === "ACCESS_GRANT_PATCH" || type === "ACCESS_GRANT_UPDATE") {`
);

replaceOnce(
  "process start canonical",
`    if (type === "INSTANCE_START") {
      const targetsRaw = Array.isArray(effect?.service_object_ids)`,
`    if (type === "PROCESS_START" || type === "INSTANCE_START") {
      if (type === "PROCESS_START" && Array.isArray(effect?.service_object_ids)) {
        throw new Error("PROCESS_START_MULTI_TARGET_UNSUPPORTED");
      }
      const targetsRaw = Array.isArray(effect?.service_object_ids)`
);

fs.writeFileSync(enginePath, source);
console.log(`updated ${path.relative(root, enginePath)}`);
