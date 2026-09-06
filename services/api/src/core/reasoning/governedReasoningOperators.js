function assertFiniteNumber(value, label = "value") {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`REASONING_NUMBER_REQUIRED:${label}`);
  return n;
}

function assertArray(value, label = "value") {
  if (!Array.isArray(value)) throw new Error(`REASONING_ARRAY_REQUIRED:${label}`);
  return value;
}

function assertNonEmptyNumericArgs(args, code) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error(`REASONING_${code}_ARGS_REQUIRED`);
  }
  return args.map((value, index) => assertFiniteNumber(value, `${code}[${index}]`));
}

export const GOVERNED_REASONING_OPERATORS = Object.freeze({
  ADD: (...args) => args.reduce((sum, value, index) => sum + assertFiniteNumber(value, `ADD[${index}]`), 0),
  SUBTRACT: (a, b) => assertFiniteNumber(a, "SUBTRACT.a") - assertFiniteNumber(b, "SUBTRACT.b"),
  MULTIPLY: (...args) => args.reduce((product, value, index) => product * assertFiniteNumber(value, `MULTIPLY[${index}]`), 1),
  DIVIDE: (a, b) => {
    const denominator = assertFiniteNumber(b, "DIVIDE.b");
    if (denominator === 0) throw new Error("REASONING_DIVIDE_BY_ZERO");
    return assertFiniteNumber(a, "DIVIDE.a") / denominator;
  },
  MOD: (a, b) => {
    const divisor = assertFiniteNumber(b, "MOD.b");
    if (divisor === 0) throw new Error("REASONING_MOD_BY_ZERO");
    return assertFiniteNumber(a, "MOD.a") % divisor;
  },
  MIN: (...args) => Math.min(...assertNonEmptyNumericArgs(args, "MIN")),
  MAX: (...args) => Math.max(...assertNonEmptyNumericArgs(args, "MAX")),
  ABS: (value) => Math.abs(assertFiniteNumber(value, "ABS.value")),
  ROUND: (value) => Math.round(assertFiniteNumber(value, "ROUND.value")),
  FLOOR: (value) => Math.floor(assertFiniteNumber(value, "FLOOR.value")),
  CEIL: (value) => Math.ceil(assertFiniteNumber(value, "CEIL.value")),

  EQ: (a, b) => a === b,
  NE: (a, b) => a !== b,
  GT: (a, b) => assertFiniteNumber(a, "GT.a") > assertFiniteNumber(b, "GT.b"),
  GTE: (a, b) => assertFiniteNumber(a, "GTE.a") >= assertFiniteNumber(b, "GTE.b"),
  LT: (a, b) => assertFiniteNumber(a, "LT.a") < assertFiniteNumber(b, "LT.b"),
  LTE: (a, b) => assertFiniteNumber(a, "LTE.a") <= assertFiniteNumber(b, "LTE.b"),

  AND: (...args) => args.every(Boolean),
  OR: (...args) => args.some(Boolean),
  NOT: (value) => !value,
  COALESCE: (...args) => args.find((value) => value !== null && value !== undefined),

  COUNT: (items) => assertArray(items, "COUNT.items").length,
  SUM: (items) => assertArray(items, "SUM.items").reduce(
    (sum, value, index) => sum + assertFiniteNumber(value, `SUM[${index}]`),
    0
  ),
  FIRST: (items) => assertArray(items, "FIRST.items")[0] ?? null,
  LAST: (items) => {
    const list = assertArray(items, "LAST.items");
    return list.length ? list[list.length - 1] : null;
  },
  GET: (items, index) => {
    const list = assertArray(items, "GET.items");
    const position = Math.trunc(assertFiniteNumber(index, "GET.index"));
    return list[position] ?? null;
  }
});

export function hasGovernedReasoningOperator(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(GOVERNED_REASONING_OPERATORS, normalized);
}

export function runGovernedReasoningOperator(code, args = []) {
  const normalized = String(code || "").trim().toUpperCase();
  const fn = GOVERNED_REASONING_OPERATORS[normalized];
  if (!fn) throw new Error(`REASONING_OPERATOR_NOT_ALLOWED:${normalized || "<blank>"}`);
  return fn(...args);
}
