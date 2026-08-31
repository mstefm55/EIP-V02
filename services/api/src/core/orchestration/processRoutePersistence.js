import { createHash } from "crypto";
import { runProcessRouteLifecycleTick } from "./processRouteLifecycleRuntime.js";

const ROUTE_PATH = Object.freeze(["_eip_runtime", "process_route_v1"]);
const DEFAULT_MAX_ROUTE_BYTES = 128 * 1024;
const HARD_MAX_ROUTE_BYTES = 1024 * 1024;
const DEFAULT_MAX_ROUTE_STEPS = 256;

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

function validateSnapshotShape(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("ROUTE_SNAPSHOT_REQUIRED");
  }
  if (Number(snapshot.version) !== 1) {
    throw new Error(`ROUTE_SNAPSHOT_VERSION_UNSUPPORTED:${snapshot.version ?? "<missing>"}`);
  }
  if (!Array.isArray(snapshot.steps)) throw new Error("ROUTE_SNAPSHOT_STEPS_REQUIRED");

  const maxSteps = boundedInteger(options.maxRouteSteps, DEFAULT_MAX_ROUTE_STEPS, 1, 256);
  if (snapshot.steps.length > maxSteps) throw new Error("ROUTE_SNAPSHOT_STEP_LIMIT_EXCEEDED");

  for (let index = 0; index < snapshot.steps.length; index += 1) {
    const step = snapshot.steps[index];
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`ROUTE_SNAPSHOT_STEP_INVALID:${index}`);
    }
    if (!normalizeText(step.step_code)) throw new Error(`ROUTE_SNAPSHOT_STEP_CODE_REQUIRED:${index}`);
    if (!normalizeText(step.process_def_id)) {
      throw new Error(`ROUTE_SNAPSHOT_PROCESS_DEF_REQUIRED:${step.step_code || index}`);
    }
  }

  const serialized = JSON.stringify(snapshot);
  const maxBytes = boundedInteger(
    options.maxRouteBytes,
    DEFAULT_MAX_ROUTE_BYTES,
    1024,
    HARD_MAX_ROUTE_BYTES
  );
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new Error("ROUTE_SNAPSHOT_SIZE_LIMIT_EXCEEDED");
  }

  return serialized;
}

function routeDigest(serialized) {
  return createHash("sha256").update(serialized).digest("hex");
}

export function digestProcessRouteSnapshot(snapshot, options = {}) {
  return routeDigest(validateSnapshotShape(snapshot, options));
}

async function readRouteProjection(client, options = {}) {
  const tenantId = requireText(options.tenantId, "TENANT_ID_REQUIRED");
  const serviceObjectId = requireText(options.serviceObjectId, "SERVICE_OBJECT_ID_REQUIRED");
  const forUpdate = options.forUpdate === true;

  const result = await client.query(
    `
    SELECT
      id,
      attrs #> $3::text[] AS route_snapshot
    FROM eip_core.service_object
    WHERE tenant_id=$1 AND id=$2
    ${forUpdate ? "FOR UPDATE" : ""}
    `,
    [tenantId, serviceObjectId, ROUTE_PATH]
  );

  if (result.rowCount === 0) throw new Error("SERVICE_OBJECT_NOT_FOUND");
  return result.rows[0]?.route_snapshot ?? null;
}

export async function loadProcessRouteSnapshot(client, options = {}) {
  const snapshot = await readRouteProjection(client, options);
  if (snapshot === null) return null;
  validateSnapshotShape(snapshot, options);
  return snapshot;
}

async function writeRouteProjection(client, snapshot, options = {}) {
  const tenantId = requireText(options.tenantId, "TENANT_ID_REQUIRED");
  const serviceObjectId = requireText(options.serviceObjectId, "SERVICE_OBJECT_ID_REQUIRED");
  const serialized = validateSnapshotShape(snapshot, options);

  const result = await client.query(
    `
    UPDATE eip_core.service_object
    SET attrs = jsonb_set(
          COALESCE(attrs, '{}'::jsonb),
          ARRAY['_eip_runtime'],
          (
            CASE
              WHEN jsonb_typeof(COALESCE(attrs, '{}'::jsonb) -> '_eip_runtime') = 'object'
                THEN COALESCE(attrs, '{}'::jsonb) -> '_eip_runtime'
              ELSE '{}'::jsonb
            END
          ) || jsonb_build_object('process_route_v1', $3::jsonb),
          true
        ),
        updated_at = now()
    WHERE tenant_id=$1 AND id=$2
    RETURNING id
    `,
    [tenantId, serviceObjectId, serialized]
  );

  if (result.rowCount === 0) throw new Error("SERVICE_OBJECT_NOT_FOUND");
  return {
    snapshot,
    digest: routeDigest(serialized),
    bytes: Buffer.byteLength(serialized, "utf8")
  };
}

export async function initializeProcessRouteSnapshot(client, snapshot, options = {}) {
  const existing = await readRouteProjection(client, {
    ...options,
    forUpdate: true
  });

  if (existing !== null && options.replaceExisting !== true) {
    throw new Error("ROUTE_SNAPSHOT_ALREADY_EXISTS");
  }

  return writeRouteProjection(client, snapshot, options);
}

export async function persistProcessRouteSnapshot(client, snapshot, options = {}) {
  return writeRouteProjection(client, snapshot, options);
}

export async function runPersistedProcessRouteLifecycleTick(client, options = {}) {
  const tenantId = requireText(options.tenantId, "TENANT_ID_REQUIRED");
  const serviceObjectId = requireText(options.serviceObjectId, "SERVICE_OBJECT_ID_REQUIRED");

  const snapshot = await loadProcessRouteSnapshot(client, {
    ...options,
    tenantId,
    serviceObjectId,
    forUpdate: true
  });
  if (!snapshot) throw new Error("ROUTE_SNAPSHOT_NOT_FOUND");

  const result = await runProcessRouteLifecycleTick(client, snapshot, {
    ...options,
    tenantId,
    serviceObjectId
  });

  const persisted = await persistProcessRouteSnapshot(client, result.snapshot, {
    ...options,
    tenantId,
    serviceObjectId
  });

  return {
    ...result,
    persistence: {
      route_digest: persisted.digest,
      route_bytes: persisted.bytes,
      storage: "service_object.attrs._eip_runtime.process_route_v1"
    }
  };
}
