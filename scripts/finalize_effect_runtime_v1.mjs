#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enginePath = path.join(root, "services/api/src/core/core_process_engine.js");
let source = fs.readFileSync(enginePath, "utf8");

function replaceExact(label, before, after) {
  const at = source.indexOf(before);
  if (at === -1) {
    if (source.includes(after)) return console.log(`already applied: ${label}`);
    throw new Error(`REPLACE_NOT_FOUND:${label}`);
  }
  if (source.indexOf(before, at + before.length) !== -1) throw new Error(`REPLACE_NOT_UNIQUE:${label}`);
  source = source.slice(0, at) + after + source.slice(at + before.length);
  console.log(`applied: ${label}`);
}

function removeExact(label, text) {
  const at = source.indexOf(text);
  if (at === -1) return console.log(`already removed: ${label}`);
  if (source.indexOf(text, at + text.length) !== -1) throw new Error(`REMOVE_NOT_UNIQUE:${label}`);
  source = source.slice(0, at) + source.slice(at + text.length);
  console.log(`removed: ${label}`);
}

function replaceRange(label, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  if (start === -1) {
    if (source.includes(replacement)) return console.log(`already applied: ${label}`);
    throw new Error(`RANGE_START_NOT_FOUND:${label}`);
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`RANGE_END_NOT_FOUND:${label}`);
  source = source.slice(0, start) + replacement + source.slice(end);
  console.log(`applied: ${label}`);
}

function removeRange(label, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) return console.log(`already removed: ${label}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`RANGE_END_NOT_FOUND:${label}`);
  source = source.slice(0, start) + source.slice(end);
  console.log(`removed: ${label}`);
}

function insertBefore(label, marker, insertion) {
  if (source.includes(insertion)) return console.log(`already inserted: ${label}`);
  const at = source.indexOf(marker);
  if (at === -1) throw new Error(`INSERT_MARKER_NOT_FOUND:${label}`);
  source = source.slice(0, at) + insertion + source.slice(at);
  console.log(`inserted: ${label}`);
}

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

removeExact("HTTP integration Effect registry entry", '  HTTP_REQUEST: "httpRequest"\n');

removeRange(
  "HTTP integration Effect handler",
  '    if (type === "HTTP_REQUEST") {',
  '    if (type === "SERVICE_OBJECT_PATCH" || type === "SO_UPDATE") {'
);

const serviceObjectPatchReplacement = Buffer.from(
  "ICAgIGlmICh0eXBlID09PSAiU0VSVklDRV9PQkpFQ1RfUEFUQ0giIHx8IHR5cGUgPT09ICJTT19VUERBVEUiKSB7CiAgICAgIGNvbnN0IGNhbm9uaWNhbFJlcXVlc3QgPSByZXNvbHZlZEVmZmVjdC5yZXF1ZXN0ZWRfY29kZSA9PT0gIlNFUlZJQ0VfT0JKRUNUX1BBVENIIjsKICAgICAgY29uc3Qgc2VydmljZU9iamVjdElkID0KICAgICAgICBub3JtYWxpemVPcHRpb25hbFRleHQocmVzb2x2ZUR5bmFtaWNWYWx1ZShlZmZlY3Q/LnNlcnZpY2Vfb2JqZWN0X2lkLCBjdHgsIHBheWxvYWQpKSB8fAogICAgICAgIGN0eC5zZXJ2aWNlT2JqZWN0SWQ7CgogICAgICBjb25zdCBoYXNDb2RlID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGVmZmVjdCB8fCB7fSwgImNvZGUiKTsKICAgICAgY29uc3QgaGFzVGl0bGUgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZWZmZWN0IHx8IHt9LCAidGl0bGUiKTsKICAgICAgY29uc3QgaGFzT3duZXJBZ2VudElkID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGVmZmVjdCB8fCB7fSwgIm93bmVyX2FnZW50X2lkIik7CiAgICAgIGNvbnN0IGNvZGVWYWx1ZSA9IGhhc0NvZGUKICAgICAgICA/IG5vcm1hbGl6ZU9wdGlvbmFsVGV4dChyZXNvbHZlRHluYW1pY1ZhbHVlKGVmZmVjdD8uY29kZSwgY3R4LCBwYXlsb2FkKSkKICAgICAgICA6IG51bGw7CiAgICAgIGNvbnN0IHRpdGxlVmFsdWUgPSBoYXNUaXRsZQogICAgICAgID8gbm9ybWFsaXplT3B0aW9uYWxUZXh0KHJlc29sdmVEeW5hbWljVmFsdWUoZWZmZWN0Py50aXRsZSwgY3R4LCBwYXlsb2FkKSkKICAgICAgICA6IG51bGw7CiAgICAgIGNvbnN0IG93bmVyQWdlbnRJZCA9IGhhc093bmVyQWdlbnRJZAogICAgICAgID8gbm9ybWFsaXplT3B0aW9uYWxUZXh0KHJlc29sdmVEeW5hbWljVmFsdWUoZWZmZWN0Py5vd25lcl9hZ2VudF9pZCwgY3R4LCBwYXlsb2FkKSkKICAgICAgICA6IG51bGw7CgogICAgICBjb25zdCBhdHRyc1ZhbHVlID0gcmVzb2x2ZUR5bmFtaWNWYWx1ZShlZmZlY3Q/LmF0dHJzLCBjdHgsIHBheWxvYWQpOwogICAgICBjb25zdCBhdHRycyA9CiAgICAgICAgYXR0cnNWYWx1ZSAmJiB0eXBlb2YgYXR0cnNWYWx1ZSA9PT0gIm9iamVjdCIgJiYgIUFycmF5LmlzQXJyYXkoYXR0cnNWYWx1ZSkKICAgICAgICAgID8gYXR0cnNWYWx1ZQogICAgICAgICAgOiBudWxsOwogICAgICBjb25zdCBwYXRjaGVzVmFsdWUgPSByZXNvbHZlRHluYW1pY1ZhbHVlKGVmZmVjdD8ucGF0Y2hlcywgY3R4LCBwYXlsb2FkKTsKICAgICAgY29uc3QgcGF0Y2hlcyA9IEFycmF5LmlzQXJyYXkocGF0Y2hlc1ZhbHVlKSAmJiBwYXRjaGVzVmFsdWUubGVuZ3RoID4gMCA/IHBhdGNoZXNWYWx1ZSA6IG51bGw7CgogICAgICBpZiAoY2Fub25pY2FsUmVxdWVzdCAmJiBlZmZlY3Q/LmF0dHJzICE9PSB1bmRlZmluZWQpIHsKICAgICAgICB0aHJvdyBuZXcgRXJyb3IoIlNFUlZJQ0VfT0JKRUNUX1BBVENIX0FUVFJTX01FUkdFX1VOU1VQUE9SVEVEIik7CiAgICAgIH0KICAgICAgaWYgKGNhbm9uaWNhbFJlcXVlc3QgJiYgIWhhc0NvZGUgJiYgIWhhc1RpdGxlICYmICFoYXNPd25lckFnZW50SWQgJiYgIXBhdGNoZXMpIHsKICAgICAgICB0aHJvdyBuZXcgRXJyb3IoIlNFUlZJQ0VfT0JKRUNUX1BBVENIX0VNUFRZIik7CiAgICAgIH0KICAgICAgaWYgKCFjYW5vbmljYWxSZXF1ZXN0ICYmICFoYXNDb2RlICYmICFoYXNUaXRsZSAmJiAhaGFzT3duZXJBZ2VudElkICYmICFhdHRycyAmJiAhcGF0Y2hlcykgewogICAgICAgIHRocm93IG5ldyBFcnJvcigiU09fVVBEQVRFX0VNUFRZIik7CiAgICAgIH0KCiAgICAgIGlmIChoYXNPd25lckFnZW50SWQgJiYgb3duZXJBZ2VudElkKSB7CiAgICAgICAgY29uc3Qgb3duZXJSZXMgPSBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgICBgCiAgICAgICAgICBTRUxFQ1QgMQogICAgICAgICAgRlJPTSBlaXBfY29yZS5hZ2VudAogICAgICAgICAgV0hFUkUgdGVuYW50X2lkPSQxIEFORCBpZD0kMiBBTkQgaXNfYWN0aXZlPXRydWUKICAgICAgICAgIExJTUlUIDEKICAgICAgICAgIGAsCiAgICAgICAgICBbY3R4LnRlbmFudElkLCBvd25lckFnZW50SWRdCiAgICAgICAgKTsKICAgICAgICBpZiAob3duZXJSZXMucm93Q291bnQgPT09IDApIHRocm93IG5ldyBFcnJvcigiT1dORVJfQUdFTlRfTk9UX0ZPVU5EIik7CiAgICAgIH0KCiAgICAgIGNvbnN0IHJlbGF0aW9uYWxNdXRhdGlvbiA9IGhhc0NvZGUgfHwgaGFzVGl0bGUgfHwgaGFzT3duZXJBZ2VudElkOwogICAgICBjb25zdCBsZWdhY3lBdHRyc01lcmdlID0gIWNhbm9uaWNhbFJlcXVlc3QgJiYgYXR0cnMgIT09IG51bGw7CiAgICAgIGlmIChyZWxhdGlvbmFsTXV0YXRpb24gfHwgbGVnYWN5QXR0cnNNZXJnZSkgewogICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNsaWVudC5xdWVyeSgKICAgICAgICAgIGAKICAgICAgICAgIFVQREFURSBlaXBfY29yZS5zZXJ2aWNlX29iamVjdAogICAgICAgICAgU0VUIGNvZGUgPSBDQVNFIFdIRU4gJDM6OmJvb2xlYW4gVEhFTiAkNCBFTFNFIGNvZGUgRU5ELAogICAgICAgICAgICAgIHRpdGxlID0gQ0FTRSBXSEVOICQ1Ojpib29sZWFuIFRIRU4gJDYgRUxTRSB0aXRsZSBFTkQsCiAgICAgICAgICAgICAgb3duZXJfYWdlbnRfaWQgPSBDQVNFIFdIRU4gJDc6OmJvb2xlYW4gVEhFTiAkODo6dXVpZCBFTFNFIG93bmVyX2FnZW50X2lkIEVORCwKICAgICAgICAgICAgICBhdHRycyA9IENBU0UKICAgICAgICAgICAgICAgIFdIRU4gJDk6OmJvb2xlYW4gVEhFTiBDT0FMRVNDRShhdHRycywne30nOjpqc29uYikgfHwgJDEwOjpqc29uYgogICAgICAgICAgICAgICAgRUxTRSBhdHRycwogICAgICAgICAgICAgIEVORCwKICAgICAgICAgICAgICB1cGRhdGVkX2F0ID0gbm93KCkKICAgICAgICAgIFdIRVJFIHRlbmFudF9pZD0kMSBBTkQgaWQ9JDIKICAgICAgICAgIGAsCiAgICAgICAgICBbCiAgICAgICAgICAgIGN0eC50ZW5hbnRJZCwKICAgICAgICAgICAgc2VydmljZU9iamVjdElkLAogICAgICAgICAgICBoYXNDb2RlLAogICAgICAgICAgICBjb2RlVmFsdWUsCiAgICAgICAgICAgIGhhc1RpdGxlLAogICAgICAgICAgICB0aXRsZVZhbHVlLAogICAgICAgICAgICBoYXNPd25lckFnZW50SWQsCiAgICAgICAgICAgIG93bmVyQWdlbnRJZCwKICAgICAgICAgICAgbGVnYWN5QXR0cnNNZXJnZSwKICAgICAgICAgICAgbGVnYWN5QXR0cnNNZXJnZSA/IEpTT04uc3RyaW5naWZ5KGF0dHJzKSA6IG51bGwKICAgICAgICAgIF0KICAgICAgICApOwogICAgICAgIGlmIChyZXN1bHQucm93Q291bnQgPT09IDApIHRocm93IG5ldyBFcnJvcigiU0VSVklDRV9PQkpFQ1RfTk9UX0ZPVU5EIik7CiAgICAgIH0KCiAgICAgIGxldCBwYXRjaFJlc3VsdCA9IG51bGw7CiAgICAgIGlmIChwYXRjaGVzKSB7CiAgICAgICAgcGF0Y2hSZXN1bHQgPSBhd2FpdCBwYXRjaFNlcnZpY2VPYmplY3RBdHRycyhjbGllbnQsIHsKICAgICAgICAgIHRlbmFudElkOiBjdHgudGVuYW50SWQsCiAgICAgICAgICBzZXJ2aWNlT2JqZWN0SWQsCiAgICAgICAgICBwYXRjaGVzCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAgIGFwcGxpZWQucHVzaCh7CiAgICAgICAgdHlwZSwKICAgICAgICBzZXJ2aWNlX29iamVjdF9pZDogc2VydmljZU9iamVjdElkLAogICAgICAgIHJlbGF0aW9uYWxfZmllbGRzOiBbCiAgICAgICAgICAuLi4oaGFzQ29kZSA/IFsiY29kZSJdIDogW10pLAogICAgICAgICAgLi4uKGhhc1RpdGxlID8gWyJ0aXRsZSJdIDogW10pLAogICAgICAgICAgLi4uKGhhc093bmVyQWdlbnRJZCA/IFsib3duZXJfYWdlbnRfaWQiXSA6IFtdKQogICAgICAgIF0sCiAgICAgICAgcGF0Y2hfY291bnQ6IHBhdGNoUmVzdWx0Py5wYXRjaF9jb3VudCB8fCAwCiAgICAgIH0pOwogICAgICBjb250aW51ZTsKICAgIH0KCg==",
  "base64"
).toString("utf8");

replaceRange(
  "SERVICE_OBJECT_PATCH governed field contract",
  '    if (type === "SERVICE_OBJECT_PATCH" || type === "SO_UPDATE") {',
  '    if (type === "TASK_CREATE") {',
  serviceObjectPatchReplacement
);

const linkPatchHandler = `    if (type === "LINK_PATCH") {
      const srcKind = normalizeOptionalText(resolveDynamicValue(effect?.src_kind, ctx, payload));
      const dstKind = normalizeOptionalText(resolveDynamicValue(effect?.dst_kind, ctx, payload));
      const relationType = normalizeOptionalText(resolveDynamicValue(effect?.relation_type, ctx, payload));
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

      applied.push({ type, relation_type: relationType, patch_count: patchResult.patch_count });
      continue;
    }

`;

insertBefore("LINK_PATCH runtime handler", '    if (type === "LINK_REMOVE") {', linkPatchHandler);

fs.writeFileSync(enginePath, source);
console.log(`updated ${path.relative(root, enginePath)}`);
