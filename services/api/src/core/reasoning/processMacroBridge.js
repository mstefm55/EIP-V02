import {
  collectMacroParentAttrPaths,
  executeMacroReasoning
} from "./macroReasoning.js";

const DEFAULT_MAX_PARENT_ATTR_PATHS = 64;
const DEFAULT_MAX_PATH_SEGMENTS = 16;
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function boundedInteger(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function hasReasoningBlocks(macro) {
  const blocks = macro?.reasoning ?? macro?.calculations;
  return Array.isArray(blocks) && blocks.length > 0;
}

function normalizeAttrPath(path, maxSegments) {
  const segments = String(path || "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0 || segments.length > maxSegments) {
    throw new Error("MACRO_PARENT_ATTR_PATH_INVALID");
  }
  if (segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))) {
    throw new Error("MACRO_PARENT_ATTR_PATH_FORBIDDEN");
  }
  return segments;
}

function assignPath(root, segments, value) {
  let current = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!current[segment] || typeof current[segment] !== "object" || Array.isArray(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[segments[segments.length - 1]] = value;
}

function resolvePath(root, path) {
  const segments = String(path || "").split(".").filter(Boolean);
  let current = root;
  for (const segment of segments) {
    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) throw new Error("CALC_REFERENCE_FORBIDDEN");
    if (current === null || current === undefined) return undefined;
    current = current[segment];
  }
  return current;
}

export function resolveCalculatedRef(value, calc) {
  if (typeof value !== "string") return value;
  if (value === "$calc") return calc || {};
  const match = value.match(/^\$calc\.(.+)$/);
  if (!match) return value;
  return resolvePath(calc || {}, match[1]);
}

export async function loadMacroParentProjection(client, options = {}) {
  const tenantId = String(options.tenantId || "").trim();
  const serviceObjectId = String(options.serviceObjectId || options.serviceObject?.id || "").trim();
  const macro = options.macro || {};

  if (!tenantId) throw new Error("TENANT_ID_REQUIRED");
  if (!serviceObjectId) throw new Error("SERVICE_OBJECT_ID_REQUIRED");

  const maxPaths = boundedInteger(
    options.maxParentAttrPaths,
    DEFAULT_MAX_PARENT_ATTR_PATHS,
    1,
    256
  );
  const maxSegments = boundedInteger(
    options.maxPathSegments,
    DEFAULT_MAX_PATH_SEGMENTS,
    1,
    64
  );

  const paths = collectMacroParentAttrPaths(macro);
  if (paths.length > maxPaths) throw new Error("MACRO_PARENT_ATTR_PATH_LIMIT_EXCEEDED");

  const parent = {
    ...(options.serviceObject || {}),
    id: serviceObjectId,
    attrs: {}
  };

  if (paths.length === 0) {
    return { parent, paths, query_count: 0 };
  }

  const normalized = paths.map((path) => ({
    path,
    segments: normalizeAttrPath(path, maxSegments)
  }));

  const selectFragments = normalized.flatMap((_, index) => {
    const parameter = `$${index + 3}::text[]`;
    return [
      `(attrs #> ${parameter}) IS NOT NULL AS present_${index}`,
      `attrs #> ${parameter} AS value_${index}`
    ];
  });

  const result = await client.query(
    `
    SELECT
      ${selectFragments.join(",\n      ")}
    FROM eip_core.service_object
    WHERE tenant_id=$1 AND id=$2
    LIMIT 1
    `,
    [tenantId, serviceObjectId, ...normalized.map((entry) => entry.segments)]
  );

  if (result.rowCount === 0) throw new Error("SERVICE_OBJECT_NOT_FOUND");
  const row = result.rows[0] || {};

  normalized.forEach((entry, index) => {
    if (row[`present_${index}`] === true) {
      assignPath(parent.attrs, entry.segments, row[`value_${index}`]);
    }
  });

  return { parent, paths, query_count: 1 };
}

export async function executeProcessMacroReasoning(client, options = {}) {
  const macro = options.macro || {};
  if (!hasReasoningBlocks(macro)) {
    return {
      executed: false,
      calc: {},
      audit: [],
      calc_digest: null,
      parent_attr_paths: [],
      projection_queries: 0
    };
  }

  const projection = await loadMacroParentProjection(client, options);
  const result = executeMacroReasoning(
    macro,
    {
      parent: projection.parent,
      policy: options.policy || {},
      context: options.context || {},
      input: options.input || {}
    },
    {
      maxBlocks: options.maxBlocks,
      maxCalcBytes: options.maxCalcBytes,
      limits: options.limits
    }
  );

  return {
    executed: true,
    calc: result.calc,
    audit: result.audit,
    calc_digest: result.calc_digest,
    parent_attr_paths: projection.paths,
    projection_queries: projection.query_count
  };
}
