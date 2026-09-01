const DEFAULT_MAX_PATCHES = 64;
const HARD_MAX_PATCHES = 256;
const DEFAULT_MAX_PATH_SEGMENTS = 32;
const HARD_MAX_PATH_SEGMENTS = 64;
const DEFAULT_MAX_SEGMENT_LENGTH = 128;
const HARD_MAX_SEGMENT_LENGTH = 512;
const DEFAULT_MAX_PATCH_BYTES = 256 * 1024;
const HARD_MAX_PATCH_BYTES = 1024 * 1024;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function boundedInteger(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeOperation(value) {
  const op = String(value || "SET").trim().toUpperCase();
  if (!["SET", "REMOVE"].includes(op)) {
    throw new Error(`SO_PATCH_OPERATION_INVALID:${op || "<empty>"}`);
  }
  return op;
}

function normalizePath(path, options = {}) {
  const maxSegments = boundedInteger(
    options.maxPathSegments,
    DEFAULT_MAX_PATH_SEGMENTS,
    1,
    HARD_MAX_PATH_SEGMENTS
  );
  const maxSegmentLength = boundedInteger(
    options.maxSegmentLength,
    DEFAULT_MAX_SEGMENT_LENGTH,
    1,
    HARD_MAX_SEGMENT_LENGTH
  );

  const raw = Array.isArray(path)
    ? path
    : typeof path === "string"
      ? path.split(".")
      : null;

  if (!raw || raw.length === 0) throw new Error("SO_PATCH_PATH_REQUIRED");
  if (raw.length > maxSegments) throw new Error("SO_PATCH_PATH_SEGMENT_LIMIT_EXCEEDED");

  return raw.map((segment, index) => {
    if (segment === null || segment === undefined) {
      throw new Error(`SO_PATCH_PATH_SEGMENT_INVALID:${index}`);
    }
    const text = String(segment).trim();
    if (!text || text.length > maxSegmentLength || FORBIDDEN_SEGMENTS.has(text)) {
      throw new Error(`SO_PATCH_PATH_SEGMENT_INVALID:${index}`);
    }
    return text;
  });
}

function serializePatchValue(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("SO_PATCH_VALUE_UNSERIALIZABLE");
  return serialized;
}

export function normalizeServiceObjectAttrPatches(patches, options = {}) {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error("SO_PATCHES_REQUIRED");
  }

  const maxPatches = boundedInteger(
    options.maxPatches,
    DEFAULT_MAX_PATCHES,
    1,
    HARD_MAX_PATCHES
  );
  if (patches.length > maxPatches) throw new Error("SO_PATCH_LIMIT_EXCEEDED");

  const maxPatchBytes = boundedInteger(
    options.maxPatchBytes,
    DEFAULT_MAX_PATCH_BYTES,
    1024,
    HARD_MAX_PATCH_BYTES
  );

  let totalBytes = 0;
  const normalized = patches.map((patch, index) => {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error(`SO_PATCH_INVALID:${index}`);
    }

    const op = normalizeOperation(patch.op ?? patch.operation);
    const path = normalizePath(patch.path, options);

    if (op === "REMOVE") {
      totalBytes += Buffer.byteLength(JSON.stringify(path), "utf8");
      return { op, path };
    }

    const serializedValue = serializePatchValue(patch.value);
    totalBytes += Buffer.byteLength(JSON.stringify(path), "utf8");
    totalBytes += Buffer.byteLength(serializedValue, "utf8");
    return {
      op,
      path,
      value: patch.value,
      serialized_value: serializedValue
    };
  });

  if (totalBytes > maxPatchBytes) throw new Error("SO_PATCH_SIZE_LIMIT_EXCEEDED");
  return normalized;
}

export function buildServiceObjectAttrsPatchExpression(patches, options = {}) {
  const normalized = normalizeServiceObjectAttrPatches(patches, options);
  const startParam = boundedInteger(options.startParam, 3, 1, 100000);

  let expression = "COALESCE(attrs, '{}'::jsonb)";
  const params = [];
  let paramIndex = startParam;

  for (const patch of normalized) {
    if (patch.op === "REMOVE") {
      expression = `(${expression} #- $${paramIndex}::text[])`;
      params.push(patch.path);
      paramIndex += 1;
      continue;
    }

    expression = `jsonb_set(${expression}, $${paramIndex}::text[], $${paramIndex + 1}::jsonb, true)`;
    params.push(patch.path, patch.serialized_value);
    paramIndex += 2;
  }

  return {
    expression,
    params,
    patches: normalized
  };
}

export async function patchServiceObjectAttrs(client, options = {}) {
  if (!client || typeof client.query !== "function") throw new Error("SO_PATCH_CLIENT_REQUIRED");

  const tenantId = String(options.tenantId || "").trim();
  const serviceObjectId = String(options.serviceObjectId || "").trim();
  if (!tenantId) throw new Error("TENANT_ID_REQUIRED");
  if (!serviceObjectId) throw new Error("SERVICE_OBJECT_ID_REQUIRED");

  const built = buildServiceObjectAttrsPatchExpression(options.patches, {
    ...options,
    startParam: 3
  });

  const result = await client.query(
    `
    UPDATE eip_core.service_object
    SET attrs = ${built.expression},
        updated_at = now()
    WHERE tenant_id=$1 AND id=$2
    RETURNING id
    `,
    [tenantId, serviceObjectId, ...built.params]
  );

  if (result.rowCount === 0) throw new Error("SERVICE_OBJECT_NOT_FOUND");

  return {
    service_object_id: serviceObjectId,
    patch_count: built.patches.length,
    operations: built.patches.map((patch) => ({ op: patch.op, path: patch.path }))
  };
}
