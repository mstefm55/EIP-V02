import { createHash } from "node:crypto";
import { executeGovernedReasoningProgram } from "./governedReasoningRuntime.js";

const DEFAULT_MAX_BLOCKS = 32;
const DEFAULT_MAX_CALC_BYTES = 64 * 1024;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function safeKey(value) {
  const key = String(value || "").trim();
  if (!key || key.includes(".") || FORBIDDEN_KEYS.has(key)) throw new Error("MACRO_REASONING_KEY_INVALID");
  return key;
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

function getReasoningBlocks(macro) {
  if (!macro || typeof macro !== "object") return [];
  const blocks = macro.reasoning || macro.calculations || [];
  if (!Array.isArray(blocks)) throw new Error("MACRO_REASONING_BLOCKS_ARRAY_REQUIRED");
  return blocks;
}

function compileBlockProgram(block) {
  const hasExpression = Object.prototype.hasOwnProperty.call(block, "expression");
  const hasProgram = Object.prototype.hasOwnProperty.call(block, "program");
  if (hasExpression === hasProgram) throw new Error("MACRO_REASONING_EXPRESSION_XOR_PROGRAM_REQUIRED");
  if (hasProgram) return block.program;
  return { steps: [{ emit: block.expression }] };
}

export function executeMacroReasoning(macro, input = {}, options = {}) {
  const blocks = getReasoningBlocks(macro);
  const maxBlocks = Math.max(1, Math.min(256, Number(options.maxBlocks) || DEFAULT_MAX_BLOCKS));
  const maxCalcBytes = Math.max(1024, Math.min(1024 * 1024, Number(options.maxCalcBytes) || DEFAULT_MAX_CALC_BYTES));
  if (blocks.length > maxBlocks) throw new Error("MACRO_REASONING_BLOCK_LIMIT_EXCEEDED");

  const calc = {};
  const audit = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) throw new Error("MACRO_REASONING_BLOCK_INVALID");
    const key = safeKey(block.as || block.key);
    if (Object.prototype.hasOwnProperty.call(calc, key)) throw new Error(`MACRO_REASONING_DUPLICATE_KEY:${key}`);

    const execution = executeGovernedReasoningProgram(
      compileBlockProgram(block),
      {
        parent: input.parent || {},
        policy: block.policy || input.policy || {},
        context: { ...(input.context || {}), calc },
        input: input.input || {}
      },
      { limits: block.limits || options.limits }
    );

    const value = execution.outputs.length === 1 ? execution.outputs[0] : execution.outputs;
    calc[key] = value;
    if (byteLength(calc) > maxCalcBytes) throw new Error("MACRO_REASONING_RESULT_SIZE_EXCEEDED");
    audit.push({
      key,
      steps: execution.audit.steps,
      emits: execution.audit.emits,
      result_digest: digest(value)
    });
  }

  return {
    calc,
    audit,
    calc_digest: digest(calc)
  };
}

function visit(value, callback) {
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, callback));
    return;
  }
  if (!value || typeof value !== "object") return;
  callback(value);
  Object.values(value).forEach((item) => visit(item, callback));
}

export function collectMacroReasoningReferences(macro) {
  const refs = new Set();
  for (const block of getReasoningBlocks(macro)) {
    visit(block, (value) => {
      if (typeof value.ref === "string" && value.ref.startsWith("$")) refs.add(value.ref);
    });
  }
  return [...refs].sort();
}

export function collectMacroParentAttrPaths(macro) {
  const prefix = "$parent.attrs.";
  return collectMacroReasoningReferences(macro)
    .filter((ref) => ref.startsWith(prefix))
    .map((ref) => ref.slice(prefix.length))
    .filter((path) => path && !path.split(".").some((part) => FORBIDDEN_KEYS.has(part)))
    .filter((path, index, array) => array.indexOf(path) === index)
    .sort();
}
