import { createHash } from "node:crypto";
import { executeGovernedReasoningProgram } from "../reasoning/governedReasoningRuntime.js";

const DEFAULT_MAX_ATTR_PATHS = 64;
const HARD_MAX_ATTR_PATHS = 256;
const DEFAULT_MAX_PATH_DEPTH = 8;
const HARD_MAX_PATH_DEPTH = 16;
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const ALLOWED_REASONING_ROOTS = new Set(["parent", "policy", "context", "input"]);

function normalizeText(value) {
  return String(value || "").trim();
}

function requireText(value, code) {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(code);
  return normalized;
}

function boundedInteger(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function routeMetadata(candidate) {
  const attrs = candidate?.binding_attrs;
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return {};
  if (attrs.route_v1 === undefined || attrs.route_v1 === null) return {};
  if (typeof attrs.route_v1 !== "object" || Array.isArray(attrs.route_v1)) {
    throw new Error(`ROUTE_BINDING_METADATA_INVALID:${candidate.binding_id || "<unknown>"}`);
  }
  return attrs.route_v1;
}

function applicabilitySpec(candidate) {
  const meta = routeMetadata(candidate);
  if (meta.applicability === undefined || meta.applicability === null) return null;
  if (typeof meta.applicability !== "object" || Array.isArray(meta.applicability)) {
    throw new Error(`ROUTE_APPLICABILITY_SPEC_INVALID:${candidate.binding_id || "<unknown>"}`);
  }
  if (!Object.prototype.hasOwnProperty.call(meta.applicability, "expression")) {
    throw new Error(`ROUTE_APPLICABILITY_EXPRESSION_REQUIRED:${candidate.binding_id || "<unknown>"}`);
  }
  return meta.applicability;
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

function collectExpressionReferences(expression) {
  const refs = new Set();
  visit(expression, (value) => {
    if (typeof value.ref !== "string") return;
    const ref = value.ref.trim();
    if (!ref.startsWith("$")) return;

    const token = ref.slice(1);
    const root = token.split(".", 1)[0];
    if (!ALLOWED_REASONING_ROOTS.has(root)) {
      throw new Error(`ROUTE_APPLICABILITY_REFERENCE_ROOT_NOT_ALLOWED:${root || "<blank>"}`);
    }
    refs.add(ref);
  });
  return [...refs].sort();
}

function validateAttrPath(path, maxDepth) {
  const parts = String(path || "").split(".").filter(Boolean);
  if (parts.length === 0) throw new Error("ROUTE_APPLICABILITY_ATTR_PATH_INVALID");
  if (parts.length > maxDepth) throw new Error("ROUTE_APPLICABILITY_ATTR_PATH_DEPTH_EXCEEDED");
  if (parts.some((part) => FORBIDDEN_PATH_SEGMENTS.has(part))) {
    throw new Error("ROUTE_APPLICABILITY_ATTR_PATH_FORBIDDEN");
  }
  return parts;
}

export function collectRouteApplicabilityParentAttrPaths(candidates, options = {}) {
  if (!Array.isArray(candidates)) throw new Error("ROUTE_CANDIDATES_ARRAY_REQUIRED");

  const maxAttrPaths = boundedInteger(
    options.maxApplicabilityAttrPaths,
    DEFAULT_MAX_ATTR_PATHS,
    1,
    HARD_MAX_ATTR_PATHS
  );
  const maxDepth = boundedInteger(
    options.maxApplicabilityAttrPathDepth,
    DEFAULT_MAX_PATH_DEPTH,
    1,
    HARD_MAX_PATH_DEPTH
  );

  const paths = new Set();
  for (const candidate of candidates) {
    const spec = applicabilitySpec(candidate);
    if (!spec) continue;
    for (const ref of collectExpressionReferences(spec.expression)) {
      const prefix = "$parent.attrs.";
      if (!ref.startsWith(prefix)) continue;
      const path = ref.slice(prefix.length);
      validateAttrPath(path, maxDepth);
      paths.add(path);
      if (paths.size > maxAttrPaths) throw new Error("ROUTE_APPLICABILITY_ATTR_PATH_LIMIT_EXCEEDED");
    }
  }

  return [...paths].sort();
}

function setNested(target, parts, value) {
  let cursor = target;
  for (let index = 0; index < parts.length; index += 1) {
    const key = parts[index];
    if (FORBIDDEN_PATH_SEGMENTS.has(key)) throw new Error("ROUTE_APPLICABILITY_ATTR_PATH_FORBIDDEN");
    if (index === parts.length - 1) {
      cursor[key] = value;
      return;
    }
    if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
}

async function loadProjectedParent(client, candidates, options = {}) {
  const tenantId = requireText(options.tenantId, "TENANT_ID_REQUIRED");
  const serviceObjectId = requireText(options.serviceObjectId, "SERVICE_OBJECT_ID_REQUIRED");
  const paths = collectRouteApplicabilityParentAttrPaths(candidates, options);

  if (paths.length === 0) {
    return {
      parent: {
        id: serviceObjectId,
        object_type: normalizeText(options.serviceObjectType) || null,
        attrs: {}
      },
      parent_attr_paths: [],
      projection_queries: 0
    };
  }

  const selections = paths.map((_, index) => `attrs #> $${index + 3}::text[] AS attr_${index}`);
  const params = [
    tenantId,
    serviceObjectId,
    ...paths.map((path) => validateAttrPath(
      path,
      boundedInteger(
        options.maxApplicabilityAttrPathDepth,
        DEFAULT_MAX_PATH_DEPTH,
        1,
        HARD_MAX_PATH_DEPTH
      )
    ))
  ];

  const result = await client.query(
    `
    SELECT id, object_type, ${selections.join(", ")}
    FROM eip_core.service_object
    WHERE tenant_id=$1 AND id=$2
    LIMIT 1
    `,
    params
  );

  if (result.rowCount === 0) throw new Error("SERVICE_OBJECT_NOT_FOUND");
  const row = result.rows[0] || {};
  const attrs = {};
  for (let index = 0; index < paths.length; index += 1) {
    const value = row[`attr_${index}`];
    if (value === undefined || value === null) continue;
    setNested(attrs, validateAttrPath(paths[index], HARD_MAX_PATH_DEPTH), value);
  }

  return {
    parent: {
      id: normalizeText(row.id) || serviceObjectId,
      object_type: normalizeText(row.object_type) || normalizeText(options.serviceObjectType) || null,
      attrs
    },
    parent_attr_paths: paths,
    projection_queries: 1
  };
}

export async function resolveProcessRouteApplicability(client, candidates, options = {}) {
  if (!Array.isArray(candidates)) throw new Error("ROUTE_CANDIDATES_ARRAY_REQUIRED");

  const projected = await loadProjectedParent(client, candidates, options);
  const applicabilityByBindingId = {};
  const audit = [];

  for (const candidate of candidates) {
    const bindingId = requireText(candidate?.binding_id, "ROUTE_BINDING_ID_REQUIRED");
    const spec = applicabilitySpec(candidate);

    if (!spec) {
      applicabilityByBindingId[bindingId] = true;
      audit.push({
        binding_id: bindingId,
        source: "default_applicable",
        applicable: true
      });
      continue;
    }

    const execution = executeGovernedReasoningProgram(
      { steps: [{ emit: spec.expression }] },
      {
        parent: projected.parent,
        policy: spec.policy && typeof spec.policy === "object" && !Array.isArray(spec.policy)
          ? spec.policy
          : {},
        context: {
          tenant_id: requireText(options.tenantId, "TENANT_ID_REQUIRED"),
          service_object_id: requireText(options.serviceObjectId, "SERVICE_OBJECT_ID_REQUIRED"),
          service_object_type: normalizeText(options.serviceObjectType) || projected.parent.object_type,
          binding_id: bindingId,
          process_def_id: normalizeText(candidate.process_def_id) || null,
          process_code: normalizeText(candidate.process_code) || null,
          process_version: Number.isFinite(Number(candidate.process_version))
            ? Number(candidate.process_version)
            : null
        },
        input: options.reasoningInput && typeof options.reasoningInput === "object"
          ? options.reasoningInput
          : {}
      },
      { limits: spec.limits }
    );

    if (execution.outputs.length !== 1 || typeof execution.outputs[0] !== "boolean") {
      throw new Error(`ROUTE_APPLICABILITY_BOOLEAN_REQUIRED:${bindingId}`);
    }

    const applicable = execution.outputs[0];
    applicabilityByBindingId[bindingId] = applicable;
    audit.push({
      binding_id: bindingId,
      source: "governed_reasoning",
      applicable,
      expression_digest: digest(spec.expression),
      steps: execution.audit.steps,
      emits: execution.audit.emits
    });
  }

  return {
    applicabilityByBindingId,
    parent_attr_paths: projected.parent_attr_paths,
    projection_queries: projected.projection_queries,
    audit,
    audit_digest: digest(audit)
  };
}
