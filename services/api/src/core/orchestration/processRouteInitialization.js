import { buildProcessRouteSnapshot } from "./processRoutePlanner.js";
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

function normalizeSequence(value, required, bindingId) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`ROUTE_SEQUENCE_REQUIRED:${bindingId}`);
    return 100;
  }
  const sequence = Number(value);
  if (!Number.isFinite(sequence)) throw new Error(`ROUTE_SEQUENCE_INVALID:${bindingId}`);
  return sequence;
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
      route_metadata_version: 1
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

  const snapshot = buildProcessRouteFromCandidates(candidates, options);
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
      initial_route_digest: initialized.persistence.route_digest
    }
  };
}
