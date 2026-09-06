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

function replaceRange(label, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  if (start === -1) {
    if (source.includes(replacement)) {
      console.log(`already replaced: ${label}`);
      return;
    }
    throw new Error(`REPLACE_START_NOT_FOUND:${label}`);
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`REPLACE_END_NOT_FOUND:${label}`);
  source = source.slice(0, start) + replacement + source.slice(end);
  console.log(`replaced: ${label}`);
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

function insertBefore(label, marker, insertion) {
  if (source.includes(insertion)) {
    console.log(`already inserted: ${label}`);
    return;
  }
  const index = source.indexOf(marker);
  if (index === -1) throw new Error(`INSERT_MARKER_NOT_FOUND:${label}`);
  source = source.slice(0, index) + insertion + source.slice(index);
  console.log(`inserted: ${label}`);
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

removeExact(
  "HTTP integration Effect registry entry",
  '  HTTP_REQUEST: "httpRequest"\n'
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
  "HTTP integration Effect handler",
  '    if (type === "HTTP_REQUEST") {',
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

replaceExact(
  "object link patch import",
  'import { patchServiceObjectAttrs } from "./serviceObjectJsonPatch.js";\n',
  'import { patchServiceObjectAttrs } from "./serviceObjectJsonPatch.js";\nimport { patchObjectLinkAttrs } from "./objectLinkJsonPatch.js";\n'
);

replaceExact(
  "LINK_PATCH registry admission",
  '  LINK_CREATE: "linkCreate",\n  LINK_REMOVE: "linkRemove",',
  '  LINK_CREATE: "linkCreate",\n  LINK_PATCH: "linkPatch",\n  LINK_REMOVE: "linkRemove",'
);

replaceRange(
  "SERVICE_OBJECT_PATCH governed field contract",
  '    if (type === "SERVICE_OBJECT_PATCH" || type === "SO_UPDATE") {',
  '    if (type === "TASK_CREATE") {',
`    if (type === "SERVICE_OBJECT_PATCH" || type === "SO_UPDATE") {
      const canonicalRequest = resolvedEffect.requested_code === "SERVICE_OBJECT_PATCH";
      const serviceObjectId =
        normalizeOptionalText(resolveDynamicValue(effect?.service_object_id, ctx, payload)) ||
        ctx.serviceObjectId;

      const hasCode = Object.prototype.hasOwnProperty.call(effect || {}, "code");
      const hasTitle = Object.prototype.hasOwnProperty.call(effect || {}, "title");
      const hasOwnerAgentId = Object.prototype.hasOwnProperty.call(effect || {}, "owner_agent_id");
      const codeValue = hasCode
        ? normalizeOptionalText(resolveDynamicValue(effect?.code, ctx, payload))
        : null;
      const titleValue = hasTitle
        ? normalizeOptionalText(resolveDynamicValue(effect?.title, ctx, payload))
        : null;
      const ownerAgentId = hasOwnerAgentId
        ? normalizeOptionalText(resolveDynamicValue(effect?.owner_agent_id, ctx, payload))
        : null;

      const attrsValue = resolveDynamicValue(effect?.attrs, ctx, payload);
      const attrs =
        attrsValue && typeof attrsValue === "object" && !Array.isArray(attrsValue)
          ? attrsValue
          : null;
      const patchesValue = resolveDynamicValue(effect?.patches, ctx, payload);
      const patches = Array.isArray(patchesValue) && patchesValue.length > 0 ? patchesValue : null;

      if (canonicalRequest && effect?.attrs !== undefined) {
        throw new Error("SERVICE_OBJECT_PATCH_ATTRS_MERGE_UNSUPPORTED");
      }
      if (canonicalRequest && !hasCode && !hasTitle && !hasOwnerAgentId && !patches) {
        throw new Error("SERVICE_OBJECT_PATCH_EMPTY");
      }
      if (!canonicalRequest && !hasCode && !hasTitle && !hasOwnerAgentId && !attrs && !patches) {
        throw new Error("SO_UPDATE_EMPTY");
      }

      if (hasOwnerAgentId && ownerAgentId) {
        const ownerRes = await client.query(
          `
          SELECT 1
          FROM eip_core.agent
          WHERE tenant_id=$1 AND id=$2 AND is_active=true
          LIMIT 1
          `,
          [ctx.tenantId, ownerAgentId]
        );
        if (ownerRes.rowCount === 0) throw new Error("OWNER_AGENT_NOT_FOUND");
      }

      const relationalMutation = hasCode || hasTitle || hasOwnerAgentId;
      const legacyAttrsMerge = !canonicalRequest && attrs !== null;
      if (relationalMutation || legacyAttrsMerge) {
        const result = await client.query(
          `
          UPDATE eip_core.service_object
          SET code = CASE WHEN $3::boolean THEN $4 ELSE code END,
              title = CASE WHEN $5::boolean THEN $6 ELSE title END,
              owner_agent_id = CASE WHEN $7::boolean THEN $8::uuid ELSE owner_agent_id END,
              attrs = CASE
                WHEN $9::boolean THEN COALESCE(attrs,'{}'::jsonb) || $10::jsonb
                ELSE attrs
              END,
              updated_at = now()
          WHERE tenant_id=$1 AND id=$2
          `,
          [
            ctx.tenantId,
            serviceObjectId,
            hasCode,
            codeValue,
            hasTitle,
            titleValue,
            hasOwnerAgentId,
            ownerAgentId,
            legacyAttrsMerge,
            legacyAttrsMerge ? JSON.stringify(attrs) : null
          ]
        );
        if (result.rowCount === 0) throw new Error("SERVICE_OBJECT_NOT_FOUND");
      }

      let patchResult = null;
      if (patches) {
        patchResult = await patchServiceObjectAttrs(client, {
          tenantId: ctx.tenantId,
          serviceObjectId,
          patches
        });
      }

      applied.push({
        type,
        service_object_id: serviceObjectId,
        relational_fields: [
          ...(hasCode ? ["code"] : []),
          ...(hasTitle ? ["title"] : []),
          ...(hasOwnerAgentId ? ["owner_agent_id"] : [])
        ],
        patch_count: patchResult?.patch_count || 0
      });
      continue;
    }

`
);

insertBefore(
  "LINK_PATCH runtime handler",
  '    if (type === "LINK_REMOVE") {',
`    if (type === "LINK_PATCH") {
      const srcKind = normalizeOptionalText(resolveDynamicValue(effect?.src_kind, ctx, payload));
      const dstKind = normalizeOptionalText(resolveDynamicValue(effect?.dst_kind, ctx, payload));
      const relationType = normalizeOptionalText(
        resolveDynamicValue(effect?.relation_type, ctx, payload)
      );
      const srcId = resolveRef(effect?.src_id, ctx, payload);
      const dstId = resolveRef(effect?.dst_id, ctx, payload);
      const patches = resolveDynamicValue(effect?.patches, ctx, payload);

      if (!srcKind || !dstKind || !relationType || !srcId || !dstId) {
        throw new Error("LINK_FIELDS_REQUIRED");
      }

      const patchResult = await patchObjectLinkAttrs(client, {
        tenantId: ctx.tenantId,
        srcKind,
        srcId,
        dstKind,
        dstId,
        relationType,
        patches
      });

      applied.push({
        type,
        relation_type: relationType,
        patch_count: patchResult.patch_count
      });
      continue;
    }

`
);

fs.writeFileSync(enginePath, source);
console.log(`updated ${path.relative(root, enginePath)}`);
