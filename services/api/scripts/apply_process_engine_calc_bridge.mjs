import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const targetUrl = new URL("../src/core/core_process_engine.js", import.meta.url);
const targetPath = fileURLToPath(targetUrl);
const source = await readFile(targetPath, "utf8");
const eol = source.includes("\r\n") ? "\r\n" : "\n";

function block(lines) {
  return lines.join(eol);
}

function replaceOnce(text, search, replacement, code) {
  const first = text.indexOf(search);
  if (first < 0) throw new Error(`${code}:ANCHOR_NOT_FOUND`);
  if (text.indexOf(search, first + search.length) >= 0) {
    throw new Error(`${code}:ANCHOR_NOT_UNIQUE`);
  }
  return text.slice(0, first) + replacement + text.slice(first + search.length);
}

if (source.includes("executeProcessMacroReasoning") || source.includes("$calc.")) {
  throw new Error("PROCESS_ENGINE_CALC_BRIDGE_ALREADY_PRESENT");
}

let next = source;

next = replaceOnce(
  next,
  block([
    'import { sha256Hex } from "../auth/crypto.js";'
  ]),
  block([
    'import { sha256Hex } from "../auth/crypto.js";',
    'import {',
    '  executeProcessMacroReasoning,',
    '  resolveCalculatedRef',
    '} from "./reasoning/processMacroBridge.js";'
  ]),
  "CALC_IMPORT"
);

next = replaceOnce(
  next,
  block([
    '  if (typeof value === "string") {',
    '    const payloadMatch = value.match(/^\\$payload\\.(.+)$/);'
  ]),
  block([
    '  if (typeof value === "string") {',
    '    if (value === "$calc" || value.startsWith("$calc.")) {',
    '      return resolveCalculatedRef(value, ctx.calc || {});',
    '    }',
    '    const payloadMatch = value.match(/^\\$payload\\.(.+)$/);'
  ]),
  "CALC_REF"
);

next = replaceOnce(
  next,
  block([
    '  const executionPayload =',
    '    macroParams && Object.keys(macroParams).length > 0',
    '      ? { ...(payload || {}), _macro_params: macroParams }',
    '      : payload || {};',
    '',
    '  const effectsApplied = await applyEffects('
  ]),
  block([
    '  const executionPayload =',
    '    macroParams && Object.keys(macroParams).length > 0',
    '      ? { ...(payload || {}), _macro_params: macroParams }',
    '      : payload || {};',
    '',
    '  const reasoningResult = await executeProcessMacroReasoning(client, {',
    '    tenantId,',
    '    serviceObjectId: inst.service_object_id,',
    '    serviceObject: ctx.serviceObject,',
    '    macro: macroResolution.macro,',
    '    input: executionPayload,',
    '    policy: macroResolution.macro?.policy || {},',
    '    context: {',
    '      process_instance_id: inst.id,',
    '      process_def_id: inst.process_def_id,',
    '      service_object_id: inst.service_object_id',
    '    }',
    '  });',
    '  ctx.calc = reasoningResult.calc || {};',
    '',
    '  const effectsApplied = await applyEffects('
  ]),
  "CALC_EXECUTION"
);

next = replaceOnce(
  next,
  block([
    '    macro_source: macroResolution.macro_source,',
    '    macro_params: macroParams,',
    '    idempotency_key: idempotencyKey,'
  ]),
  block([
    '    macro_source: macroResolution.macro_source,',
    '    macro_params: macroParams,',
    '    ...(reasoningResult.executed',
    '      ? {',
    '          calculation: {',
    '            calc_digest: reasoningResult.calc_digest,',
    '            parent_attr_paths: reasoningResult.parent_attr_paths,',
    '            projection_queries: reasoningResult.projection_queries,',
    '            audit: reasoningResult.audit',
    '          }',
    '        }',
    '      : {}),',
    '    idempotency_key: idempotencyKey,'
  ]),
  "CALC_HISTORY"
);

await writeFile(targetPath, next, "utf8");
console.log("PROCESS_ENGINE_CALC_BRIDGE_APPLIED");
