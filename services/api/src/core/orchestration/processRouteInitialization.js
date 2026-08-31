import { buildProcessRouteSnapshot } from "./processRoutePlanner.js";
import { resolveProcessRouteApplicability } from "./processRouteApplicability.js";
import {
  loadProcessRouteSnapshot,
  persistProcessRouteSnapshot,
  runPersistedProcessRouteLifecycleTick
} from "./processRoutePersistence.js";

const DEFAULT_MAX_CANDIDATES = 64;
const HARD_MAX_CANDIDATES = 256;

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

function routeMetadata(candidate) {
  const attrs = candidate?.binding_attrs;
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return {};
  if (attrs.route_v1 === undefined || attrs.route_v1 === null) return {};
  if (typeof attrs.route_v1 !== "object" || Array.isArray(attrs.route_v1)) {
    throw new Error(`ROUTE_BINDING_METADATA_INVALID:${candidate.binding_id || "<unknown>"}`);
  }
  return attrs.route_v1;
}

function resolvedApplicability(candidate, options = {}) {
  const map = options.applicabilityByBindingId;
  if (!map || typeof map !== "object" || Array.isArray(map)) return true;
  if (!Object.prototype.hasOwnProperty.call(map, candidate.binding_id)) return true;
  const value = map[candidate.binding_id];
  if (typeof value !== "boolean") {
    throw new Error(`ROUTE_APPLICABILITY_INVALID:${candidate.binding_id}`);
  }
  return value;
}

function resolvedTemporalPolicy(candidate, meta, options = {}) {
  const map = options.temporalByBindingId;
  let value;
  if (map !== undefined) {
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      throw new Error("ROUTE_TEMPORAL_MAP_INVALID");
    }
    if (Object.prototype.hasOwnProperty.call(map, candidate.binding_id)) {
      value = map[candidate.binding_id];
    }
  }
  if (value === undefined) value = meta.temporal_v1;
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`ROUTE_TEMPORAL_POLICY_INVALID:${candidate.binding_id}`);
  }
  return { ...value };
}

function normalizeSequence(value, required, bindingId) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`ROUTE_SEQUENCE_REQUIRED:${bindingId}`);
    return 100;
  }
  const sequence = Number(value);
  if (!Number.isFinite(sequence)) throw new Error(`ROUTE_SEQUENCE_INVALID:${bindingId}`);
  return sequence;
}

function explicitApplicabilityResolution(options = {}) {
  if (!Object.prototype.hasOwnProperty.call(options, "applicabilityByBindingId")) return null;
  const map = options.applicabilityByBindingId;
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new Error("ROUTE_APPLICABILITY_MAP_INVALID");
  }
  for (const [bindingId, value] of Object.entries(map)) {
    if (typeof value !== "boolean") throw new Error(`ROUTE_APPLICABILITY_INVALID:${bindingId}`);
  }
  return {
    source: "provided",
    applicabilityByBindingId: map,
    parent_attr_paths: [],
    projection_queries: 0,
    audit: [],
    audit_digest: null
  };
}

export async function loadProcessRouteCandidates(client, options = {}) {
  const tenantId = requireText(options.tenantId, "TENANT_ID_REQUIRED");
  const serviceObjectType = requireText(options.serviceObjectType, "SERVICE_OBJECT_TYPE_REQUIRED");
  const taskType = normalizeText(options.taskType) || null;
  const maxCandidates = boundedInteger(
    options.maxCandidates,
    DEFAULT_MAX_CANDIDATES,
    1,
    HARD_MAX_CANDIDATES
  );

  const result = await client.query(
    `
    SELECT
      pb.id AS binding_id,
      pb.task_type AS binding_task_type,
      pb.priority AS binding_priority,
      pb.attrs AS binding_attrs,
      pd.id AS process_def_id,
      pd.code AS process_code,
      pd.version AS process_version,
      COALESCE(pd.graph->>'object_type', pd.attrs->>'object_type') AS declared_object_type
    FROM eip_core.process_binding pb
    JOIN eip_core.process_def pd
      ON pd.id = pb.process_def_id
     AND pd.tenant_id = pb.tenant_id
    WHERE pb.tenant_id=$1
      AND pb.service_object_type=$2
      AND pb.is_active=true
      AND pd.is_active=true
      AND (
        ($3::text IS NULL AND pb.task_type IS NULL)
        OR
        ($3::text IS NOT NULL AND (pb.task_type=$3 OR pb.task_type IS NULL))
      )
    ORDER BY
      CASE WHEN $3::text IS NOT NULL AND pb.task_type=$3 THEN 0 ELSE 1 END,
      pb.priority ASC,
      pd.code ASC,
      pd.version DESC,
      pb.id ASC
    LIMIT $4
    `,
    [tenantId, serviceObjectType, taskType, maxCandidates + 1]
  );

  const rows = result.rows || [];
  if (rows.length > maxCandidates) throw new Error("ROUTE_CANDIDATE_LIMIT_EXCEEDED");

  for (const candidate of rows) {
    const declaredType = normalizeText(candidate.declared_object_type);
    if (declaredType && declaredType !== serviceObjectType) {
      throw new Error(`ROUTE_PROCESS_OBJECT_TYPE_MISMATCH:${candidate.binding_id}`);
    }
  }

  return rows;
}

export function buildProcessRouteFromCandidates(candidates, options = {}) {
  if (!Array.isArray(candidates)) throw new Error("ROUTE_CANDIDATES_ARRAY_REQUIRED");
  if (candidates.length === 0) throw new Error("ROUTE_CANDIDATES_REQUIRED");

  const prepared = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("ROUTE_CANDIDATE_INVALID");
    }

    const bindingId = requireText(candidate.binding_id, "ROUTE_BINDING_ID_REQUIRED");
    const processDefId = requireText(candidate.process_def_id, "PROCESS_DEF_ID_REQUIRED");
    const processCode = requireText(candidate.process_code, "PROCESS_CODE_REQUIRED");
    const processVersion = Number(candidate.process_version);
    if (!Number.isFinite(processVersion) || processVersion <= 0) {
      throw new Error(`PROCESS_VERSION_INVALID:${bindingId}`);
    }

    const meta = routeMetadata(candidate);
    const applicable = resolvedApplicability(candidate, options);
    const enabled = meta.enabled !== false;
    if (!enabled || !applicable) continue;

    prepared.push({
      candidate,
      meta,
      temporal: resolvedTemporalPolicy(candidate, meta, options),
      bindingId,
      processDefId,
      processCode,
      processVersion
    });
  }

  if (prepared.length === 0) throw new Error("ROUTE_APPLICABLE_CANDIDATES_REQUIRED");
  const requireExplicitSequence = prepared.length > 1;

  const entries = prepared.map((item) => ({
    step_code: normalizeText(item.meta.step_code) || item.processCode,
    sequence: normalizeSequence(item.meta.sequence, requireExplicitSequence, item.bindingId),
    process_def_id: item.processDefId,
    process_code: item.processCode,
    process_version: item.processVersion,
    required: item.meta.required !== false,
    attrs: {
      binding_id: item.bindingId,
      binding_priority: Number.isFinite(Number(item.candidate.binding_priority))
        ? Number(item.candidate.binding_priority)
        : null,
      binding_task_type: normalizeText(item.candidate.binding_task_type) || null,
      route_metadata_version: 1,
      ...(item.temporal ? { temporal_v1: item.temporal } : {})
    }
  }));

  return buildProcessRouteSnapshot(entries, {
    maxSteps: options.maxSteps,
    createdAt: options.createdAt,
    sourceCode: options.sourceCode || "PROCESS_BINDING_ROUTE_V1",
    sourceVersion: options.sourceVersion ?? 1
  });
}

async function loadServiceObjectType(client, tenantId, serviceObjectId) {
  const result = await client.query(
    `
    SELECT id, object_type
    FROM eip_core.service_object
    WHERE tenant_id=$1 AND id=$2
    LIMIT 1
    `,
    [tenantId, serviceObjectId]
  );
  if (result.rowCount === 0) throw new Error("SERVICE_OBJECT_NOT_FOUND");
  return requireText(result.rows[0]?.object_type, "SERVICE_OBJECT_TYPE_REQUIRED");
}

export async function resolveAndPersistProcessRoute(client, options = {}) {
  const tenantId = requireText(options.tenantId, "TENANT_ID_REQUIRED");
  const serviceObjectId = requireText(options.serviceObjectId, "SERVICE_OBJECT_ID_REQUIRED");

  const existing = await loadProcessRouteSnapshot(client, {
    ...options,
    tenantId,
    serviceObjectId,
    forUpdate: true
  });
  if (existing && options.replaceExisting !== true) {
    throw new Error("ROUTE_SNAPSHOT_ALREADY_EXISTS");
  }

  const serviceObjectType = await loadServiceObjectType(client, tenantId, serviceObjectId);
  const candidates = await loadProcessRouteCandidates(client, {
    ...options,
    tenantId,
    serviceObjectType
  });

  const applicability =
    explicitApplicabilityResolution(options) ||
    await resolveProcessRouteApplicability(client, candidates, {
      ...options,
      tenantId,
      serviceObjectId,
      serviceObjectType
    });

  const snapshot = buildProcessRouteFromCandidates(candidates, {
    ...options,
    applicabilityByBindingId: applicability.applicabilityByBindingId
  });
  const persisted = await persistProcessRouteSnapshot(client, snapshot, {
    ...options,
    tenantId,
    serviceObjectId
  });

  return {
    snapshot,
    service_object_type: serviceObjectType,
    candidate_count: candidates.length,
    route_step_count: snapshot.steps.length,
    applicability: {
      source: applicability.source || "governed_reasoning",
      parent_attr_paths: applicability.parent_attr_paths || [],
      projection_queries: applicability.projection_queries || 0,
      audit: applicability.audit || [],
      audit_digest: applicability.audit_digest || null
    },
    persistence: {
      route_digest: persisted.digest,
      route_bytes: persisted.bytes,
      storage: "service_object.attrs._eip_runtime.process_route_v1"
    }
  };
}

export async function initializeAndStartProcessRoute(client, options = {}) {
  const initialized = await resolveAndPersistProcessRoute(client, options);
  const runtime = await runPersistedProcessRouteLifecycleTick(client, options);

  return {
    ...runtime,
    initialization: {
      service_object_type: initialized.service_object_type,
      candidate_count: initialized.candidate_count,
      route_step_count: initialized.route_step_count,
      initial_route_digest: initialized.persistence.route_digest,
      applicability_source: initialized.applicability.source,
      applicability_audit_digest: initialized.applicability.audit_digest,
      applicability_parent_attr_paths: initialized.applicability.parent_attr_paths,
      applicability_projection_queries: initialized.applicability.projection_queries
    }
  };
}
