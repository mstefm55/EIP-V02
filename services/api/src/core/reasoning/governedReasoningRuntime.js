import { runGovernedReasoningOperator } from "./governedReasoningOperators.js";

const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 32,
  maxSteps: 50000,
  maxIterations: 10000,
  maxEmits: 10000,
  maxCollectionSize: 20000
});

const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const RESERVED_SCOPE_KEYS = new Set(["parent", "policy", "context", "input", "item", "item_index"]);

function boundedInteger(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeLimits(input = {}) {
  return {
    maxDepth: boundedInteger(input.maxDepth, DEFAULT_LIMITS.maxDepth, 1, 128),
    maxSteps: boundedInteger(input.maxSteps, DEFAULT_LIMITS.maxSteps, 1, 500000),
    maxIterations: boundedInteger(input.maxIterations, DEFAULT_LIMITS.maxIterations, 1, 100000),
    maxEmits: boundedInteger(input.maxEmits, DEFAULT_LIMITS.maxEmits, 1, 100000),
    maxCollectionSize: boundedInteger(
      input.maxCollectionSize,
      DEFAULT_LIMITS.maxCollectionSize,
      1,
      100000
    )
  };
}

function bump(runtime, amount = 1) {
  runtime.steps += amount;
  if (runtime.steps > runtime.limits.maxSteps) throw new Error("REASONING_STEP_LIMIT_EXCEEDED");
}

function ensureCollectionWithinLimit(value, runtime) {
  if (Array.isArray(value) && value.length > runtime.limits.maxCollectionSize) {
    throw new Error("REASONING_COLLECTION_LIMIT_EXCEEDED");
  }
  return value;
}

function resolvePath(root, path) {
  if (!path) return root;
  const parts = String(path).split(".").filter(Boolean);
  let current = root;
  for (const segment of parts) {
    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) throw new Error("REASONING_REFERENCE_FORBIDDEN");
    if (current === null || current === undefined) return undefined;
    current = current[segment];
  }
  return current;
}

export function resolveReasoningRef(ref, scope) {
  const raw = String(ref || "").trim();
  if (!raw.startsWith("$")) return raw;

  const token = raw.slice(1);
  const dot = token.indexOf(".");
  const rootKey = dot === -1 ? token : token.slice(0, dot);
  const path = dot === -1 ? "" : token.slice(dot + 1);

  if (!Object.prototype.hasOwnProperty.call(scope, rootKey)) return undefined;
  return resolvePath(scope[rootKey], path);
}

function cloneScopeForItem(scope, item, index) {
  return { ...scope, item, item_index: index };
}

function evaluateSpecialForm(expression, scope, runtime, depth) {
  const special = String(expression.special || "").trim().toUpperCase();

  if (special === "IF") {
    const condition = Boolean(evaluateReasoningExpression(expression.condition, scope, runtime, depth + 1));
    return evaluateReasoningExpression(
      condition ? expression.then : expression.else,
      scope,
      runtime,
      depth + 1
    );
  }

  if (special === "FILTER") {
    const source = evaluateReasoningExpression(expression.source, scope, runtime, depth + 1);
    if (!Array.isArray(source)) throw new Error("REASONING_FILTER_SOURCE_ARRAY_REQUIRED");
    ensureCollectionWithinLimit(source, runtime);

    const output = [];
    for (let index = 0; index < source.length; index += 1) {
      bump(runtime);
      const itemScope = cloneScopeForItem(scope, source[index], index);
      if (Boolean(evaluateReasoningExpression(expression.where, itemScope, runtime, depth + 1))) {
        output.push(source[index]);
      }
    }
    return ensureCollectionWithinLimit(output, runtime);
  }

  if (special === "SORT_BY") {
    const source = evaluateReasoningExpression(expression.source, scope, runtime, depth + 1);
    if (!Array.isArray(source)) throw new Error("REASONING_SORT_SOURCE_ARRAY_REQUIRED");
    ensureCollectionWithinLimit(source, runtime);

    const direction = String(expression.direction || "ASC").trim().toUpperCase() === "DESC" ? -1 : 1;
    const decorated = source.map((item, index) => {
      bump(runtime);
      const itemScope = cloneScopeForItem(scope, item, index);
      return {
        item,
        index,
        key: evaluateReasoningExpression(expression.by, itemScope, runtime, depth + 1)
      };
    });

    decorated.sort((a, b) => {
      if (a.key === b.key) return a.index - b.index;
      if (a.key === null || a.key === undefined) return 1;
      if (b.key === null || b.key === undefined) return -1;
      return a.key < b.key ? -direction : direction;
    });
    return decorated.map((entry) => entry.item);
  }

  throw new Error(`REASONING_SPECIAL_FORM_NOT_ALLOWED:${special || "<blank>"}`);
}

export function evaluateReasoningExpression(expression, scope, runtime, depth = 0) {
  bump(runtime);
  if (depth > runtime.limits.maxDepth) throw new Error("REASONING_DEPTH_LIMIT_EXCEEDED");

  if (expression === null || expression === undefined) return expression;
  if (typeof expression !== "object") return expression;

  if (Array.isArray(expression)) {
    ensureCollectionWithinLimit(expression, runtime);
    return expression.map((item) => evaluateReasoningExpression(item, scope, runtime, depth + 1));
  }

  if (Object.prototype.hasOwnProperty.call(expression, "ref")) {
    return resolveReasoningRef(expression.ref, scope);
  }

  if (Object.prototype.hasOwnProperty.call(expression, "special")) {
    return evaluateSpecialForm(expression, scope, runtime, depth);
  }

  if (Object.prototype.hasOwnProperty.call(expression, "op")) {
    const args = Array.isArray(expression.args) ? expression.args : [];
    const resolvedArgs = args.map((arg) => evaluateReasoningExpression(arg, scope, runtime, depth + 1));
    return ensureCollectionWithinLimit(
      runGovernedReasoningOperator(expression.op, resolvedArgs),
      runtime
    );
  }

  const result = {};
  for (const [key, value] of Object.entries(expression)) {
    if (FORBIDDEN_PATH_SEGMENTS.has(key)) throw new Error("REASONING_KEY_FORBIDDEN");
    result[key] = evaluateReasoningExpression(value, scope, runtime, depth + 1);
  }
  return result;
}

function executeSteps(steps, scope, runtime) {
  if (!Array.isArray(steps)) throw new Error("REASONING_STEPS_REQUIRED");

  for (const step of steps) {
    bump(runtime);
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error("REASONING_STEP_INVALID");
    }

    if (Object.prototype.hasOwnProperty.call(step, "set")) {
      const key = String(step.set || "").trim();
      if (
        !key ||
        key.includes(".") ||
        FORBIDDEN_PATH_SEGMENTS.has(key) ||
        RESERVED_SCOPE_KEYS.has(key)
      ) {
        throw new Error("REASONING_SET_KEY_INVALID");
      }
      scope[key] = evaluateReasoningExpression(step.value, scope, runtime);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(step, "emit")) {
      if (runtime.outputs.length >= runtime.limits.maxEmits) {
        throw new Error("REASONING_EMIT_LIMIT_EXCEEDED");
      }
      runtime.outputs.push(evaluateReasoningExpression(step.emit, scope, runtime));
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(step, "if")) {
      const condition = Boolean(evaluateReasoningExpression(step.if, scope, runtime));
      executeSteps(condition ? (step.then || []) : (step.else || []), scope, runtime);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(step, "while")) {
      const localMax = boundedInteger(
        step.max_iterations,
        runtime.limits.maxIterations,
        1,
        runtime.limits.maxIterations
      );
      let iterations = 0;
      while (Boolean(evaluateReasoningExpression(step.while, scope, runtime))) {
        iterations += 1;
        if (iterations > localMax) throw new Error("REASONING_ITERATION_LIMIT_EXCEEDED");
        executeSteps(step.do || [], scope, runtime);
      }
      continue;
    }

    throw new Error("REASONING_STEP_TYPE_NOT_ALLOWED");
  }
}

export function executeGovernedReasoningProgram(program, input = {}, options = {}) {
  if (!program || typeof program !== "object" || Array.isArray(program)) {
    throw new Error("REASONING_PROGRAM_REQUIRED");
  }

  const runtime = {
    limits: normalizeLimits(options.limits || program.limits || {}),
    steps: 0,
    outputs: []
  };

  const scope = {
    parent: input.parent || {},
    policy: input.policy || {},
    context: input.context || {},
    input: input.input || {}
  };

  executeSteps(program.steps || [], scope, runtime);

  return {
    outputs: runtime.outputs,
    variables: Object.fromEntries(
      Object.entries(scope).filter(([key]) => !["parent", "policy", "context", "input"].includes(key))
    ),
    audit: {
      steps: runtime.steps,
      emits: runtime.outputs.length,
      limits: runtime.limits
    }
  };
}
