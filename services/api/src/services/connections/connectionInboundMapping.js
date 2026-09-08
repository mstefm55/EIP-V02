import { ConnectionInboundRuntimeError } from "./connectionInboundRuntime.js";

const MAX_MAPPING_DEPTH = 12;
const MAX_MAPPING_NODES = 256;
const MAX_BODY_PATH_SEGMENTS = 16;
const MAX_PROJECTED_ATTR_BYTES = 131_072;
const MAX_STATIC_TEXT = 512;
const BODY_REF_PREFIX = "$body.";
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const ROOT_MAPPING_KEYS = new Set(["service_object", "task_type"]);
const SERVICE_OBJECT_MAPPING_KEYS = new Set(["object_type", "status", "code", "title", "attrs"]);

function text(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeMappingMode(profile) {
  return text(profile?.routing?.mapping_mode).toLowerCase();
}

function mappingError(path, code, message) {
  return { path, code, message };
}

function validateBodyReference(value, path, errors) {
  if (typeof value !== "string" || !value.startsWith("$body")) return;
  if (!value.startsWith(BODY_REF_PREFIX)) {
    errors.push(mappingError(path, "MAPPING_REFERENCE_INVALID", `${path} must reference a bounded $body.<path> value.`));
    return;
  }
  const segments = value.slice(BODY_REF_PREFIX.length).split(".").filter(Boolean);
  if (segments.length === 0 || segments.length > MAX_BODY_PATH_SEGMENTS || segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))) {
    errors.push(mappingError(path, "MAPPING_REFERENCE_INVALID", `${path} contains an invalid body reference.`));
  }
}

function inspectTemplate(value, path, errors, state, depth = 0) {
  if (depth > MAX_MAPPING_DEPTH) {
    errors.push(mappingError(path, "MAPPING_DEPTH_EXCEEDED", `${path} exceeds the bounded mapping depth.`));
    return;
  }
  state.nodes += 1;
  if (state.nodes > MAX_MAPPING_NODES) {
    errors.push(mappingError(path, "MAPPING_SIZE_EXCEEDED", "Inbound mapping exceeds the bounded node count."));
    return;
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") return;
  if (typeof value === "string") {
    validateBodyReference(value, path, errors);
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      inspectTemplate(value[index], `${path}[${index}]`, errors, state, depth + 1);
    }
    return;
  }
  if (!isPlainObject(value)) {
    errors.push(mappingError(path, "MAPPING_VALUE_INVALID", `${path} contains an unsupported mapping value.`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PATH_SEGMENTS.has(key)) {
      errors.push(mappingError(`${path}.${key}`, "MAPPING_KEY_FORBIDDEN", "Inbound mapping contains a forbidden object key."));
      continue;
    }
    inspectTemplate(entry, `${path}.${key}`, errors, state, depth + 1);
  }
}

function validateInboundMappingConfig(profile, { requireMapped = false } = {}) {
  const errors = [];
  const mode = normalizeMappingMode(profile);
  const direction = text(profile?.identity?.direction).toLowerCase();
  const inbound = ["inbound", "both"].includes(direction);
  if (!inbound) return errors;
  if (!mode) {
    if (requireMapped) {
      errors.push(mappingError("routing.mapping_mode", "REQUIRED", "routing.mapping_mode is required for inbound dispatch."));
    }
    return errors;
  }
  if (mode !== "mapped") return errors;

  const mapping = profile?.routing?.mapping;
  if (!isPlainObject(mapping)) {
    errors.push(mappingError("routing.mapping", "MAPPING_REQUIRED", "Mapped inbound connections require a mapping object."));
    return errors;
  }

  for (const key of Object.keys(mapping)) {
    if (!ROOT_MAPPING_KEYS.has(key)) {
      errors.push(mappingError(`routing.mapping.${key}`, "MAPPING_FIELD_UNSUPPORTED", `Unsupported inbound mapping field: ${key}.`));
    }
  }

  const serviceObject = mapping.service_object;
  if (!isPlainObject(serviceObject)) {
    errors.push(mappingError("routing.mapping.service_object", "SERVICE_OBJECT_MAPPING_REQUIRED", "Mapped inbound connections require service_object mapping metadata."));
    return errors;
  }
  for (const key of Object.keys(serviceObject)) {
    if (!SERVICE_OBJECT_MAPPING_KEYS.has(key)) {
      errors.push(mappingError(`routing.mapping.service_object.${key}`, "MAPPING_FIELD_UNSUPPORTED", `Unsupported Service Object mapping field: ${key}.`));
    }
  }

  const objectType = text(serviceObject.object_type);
  if (!objectType) {
    errors.push(mappingError("routing.mapping.service_object.object_type", "REQUIRED", "A static governed Service Object type is required."));
  } else if (objectType.startsWith("$body")) {
    errors.push(mappingError("routing.mapping.service_object.object_type", "DYNAMIC_OBJECT_TYPE_FORBIDDEN", "External payloads cannot choose Service Object type."));
  } else if (objectType.length > MAX_STATIC_TEXT) {
    errors.push(mappingError("routing.mapping.service_object.object_type", "VALUE_TOO_LONG", "Service Object type is too long."));
  }

  const status = text(serviceObject.status);
  if (status.startsWith("$body")) {
    errors.push(mappingError("routing.mapping.service_object.status", "DYNAMIC_STATUS_FORBIDDEN", "External payloads cannot choose initial Service Object status."));
  }
  if (status.length > MAX_STATIC_TEXT) {
    errors.push(mappingError("routing.mapping.service_object.status", "VALUE_TOO_LONG", "Initial Service Object status is too long."));
  }

  const taskType = text(mapping.task_type);
  if (taskType.startsWith("$body")) {
    errors.push(mappingError("routing.mapping.task_type", "DYNAMIC_TASK_TYPE_FORBIDDEN", "External payloads cannot choose Process binding task type."));
  }
  if (taskType.length > MAX_STATIC_TEXT) {
    errors.push(mappingError("routing.mapping.task_type", "VALUE_TOO_LONG", "Process binding task type is too long."));
  }

  const state = { nodes: 0 };
  if (serviceObject.code !== undefined) inspectTemplate(serviceObject.code, "routing.mapping.service_object.code", errors, state);
  if (serviceObject.title !== undefined) inspectTemplate(serviceObject.title, "routing.mapping.service_object.title", errors, state);
  if (serviceObject.attrs !== undefined) {
    if (!isPlainObject(serviceObject.attrs)) {
      errors.push(mappingError("routing.mapping.service_object.attrs", "ATTRS_OBJECT_REQUIRED", "Mapped Service Object attrs must be an object template."));
    } else {
      inspectTemplate(serviceObject.attrs, "routing.mapping.service_object.attrs", errors, state);
    }
  }

  return errors;
}

function parseInboundJson(rawBody) {
  const buffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
  if (buffer.length === 0) {
    throw new ConnectionInboundRuntimeError("Mapped inbound dispatch requires a JSON body.", "CONNECTION_MAPPING_BODY_REQUIRED", 400);
  }
  try {
    const value = JSON.parse(buffer.toString("utf8"));
    if (value === null || typeof value !== "object") {
      throw new Error("root");
    }
    return value;
  } catch {
    throw new ConnectionInboundRuntimeError("Mapped inbound dispatch requires a valid JSON body.", "CONNECTION_MAPPING_BODY_INVALID", 400);
  }
}

function readBodyReference(body, reference) {
  const path = reference.slice(BODY_REF_PREFIX.length);
  const segments = path.split(".").filter(Boolean);
  let value = body;
  for (const segment of segments) {
    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      throw new ConnectionInboundRuntimeError("Inbound mapping contains a forbidden source path.", "CONNECTION_MAPPING_REFERENCE_INVALID", 503);
    }
    if (value === null || value === undefined || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, segment)) {
      throw new ConnectionInboundRuntimeError(`Mapped source ${reference} is missing from the inbound payload.`, "CONNECTION_MAPPING_SOURCE_MISSING", 400);
    }
    value = value[segment];
  }
  return value;
}

function cloneProjectedValue(value, depth = 0, state = { nodes: 0 }) {
  if (depth > MAX_MAPPING_DEPTH) {
    throw new ConnectionInboundRuntimeError("Mapped payload value exceeds the bounded depth.", "CONNECTION_MAPPING_VALUE_TOO_DEEP", 400);
  }
  state.nodes += 1;
  if (state.nodes > MAX_MAPPING_NODES) {
    throw new ConnectionInboundRuntimeError("Mapped payload value exceeds the bounded size.", "CONNECTION_MAPPING_VALUE_TOO_LARGE", 400);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ConnectionInboundRuntimeError("Mapped payload contains an invalid number.", "CONNECTION_MAPPING_VALUE_INVALID", 400);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => cloneProjectedValue(entry, depth + 1, state));
  if (!isPlainObject(value)) {
    throw new ConnectionInboundRuntimeError("Mapped payload contains an unsupported value.", "CONNECTION_MAPPING_VALUE_INVALID", 400);
  }
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PATH_SEGMENTS.has(key)) {
      throw new ConnectionInboundRuntimeError("Mapped payload contains a forbidden object key.", "CONNECTION_MAPPING_VALUE_INVALID", 400);
    }
    output[key] = cloneProjectedValue(entry, depth + 1, state);
  }
  return output;
}

function resolveTemplate(value, body, depth = 0, state = { nodes: 0 }) {
  if (depth > MAX_MAPPING_DEPTH) {
    throw new ConnectionInboundRuntimeError("Inbound mapping exceeds the bounded depth.", "CONNECTION_MAPPING_DEPTH_EXCEEDED", 503);
  }
  state.nodes += 1;
  if (state.nodes > MAX_MAPPING_NODES) {
    throw new ConnectionInboundRuntimeError("Inbound mapping exceeds the bounded node count.", "CONNECTION_MAPPING_SIZE_EXCEEDED", 503);
  }
  if (typeof value === "string" && value.startsWith(BODY_REF_PREFIX)) {
    return cloneProjectedValue(readBodyReference(body, value));
  }
  if (typeof value === "string" && value.startsWith("$body")) {
    throw new ConnectionInboundRuntimeError("Inbound mapping contains an invalid body reference.", "CONNECTION_MAPPING_REFERENCE_INVALID", 503);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map((entry) => resolveTemplate(entry, body, depth + 1, state));
  if (!isPlainObject(value)) {
    throw new ConnectionInboundRuntimeError("Inbound mapping contains an unsupported template value.", "CONNECTION_MAPPING_CONFIG_INVALID", 503);
  }
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PATH_SEGMENTS.has(key)) {
      throw new ConnectionInboundRuntimeError("Inbound mapping contains a forbidden object key.", "CONNECTION_MAPPING_CONFIG_INVALID", 503);
    }
    output[key] = resolveTemplate(entry, body, depth + 1, state);
  }
  return output;
}

function projectInboundServiceObject(profile, rawBody) {
  const errors = validateInboundMappingConfig(profile, { requireMapped: true });
  if (errors.length > 0) {
    const error = new ConnectionInboundRuntimeError("Inbound connection mapping is invalid.", "CONNECTION_MAPPING_CONFIG_INVALID", 503);
    error.details = errors;
    throw error;
  }
  if (normalizeMappingMode(profile) !== "mapped") {
    throw new ConnectionInboundRuntimeError("Inbound connection is not configured for mapped dispatch.", "CONNECTION_MAPPING_MODE_NOT_MAPPED", 503);
  }

  const body = parseInboundJson(rawBody);
  const mapping = profile.routing.mapping;
  const source = mapping.service_object;
  const codeValue = source.code === undefined ? null : resolveTemplate(source.code, body);
  const titleValue = source.title === undefined ? null : resolveTemplate(source.title, body);
  if (codeValue !== null && typeof codeValue !== "string" && typeof codeValue !== "number") {
    throw new ConnectionInboundRuntimeError("Mapped Service Object code must resolve to a scalar value.", "CONNECTION_MAPPING_CODE_INVALID", 400);
  }
  if (titleValue !== null && typeof titleValue !== "string" && typeof titleValue !== "number") {
    throw new ConnectionInboundRuntimeError("Mapped Service Object title must resolve to a scalar value.", "CONNECTION_MAPPING_TITLE_INVALID", 400);
  }

  const attrs = source.attrs === undefined ? {} : resolveTemplate(source.attrs, body);
  if (!isPlainObject(attrs)) {
    throw new ConnectionInboundRuntimeError("Mapped Service Object attrs must resolve to an object.", "CONNECTION_MAPPING_ATTRS_INVALID", 400);
  }
  const attrsBytes = Buffer.byteLength(JSON.stringify(attrs), "utf8");
  if (attrsBytes > MAX_PROJECTED_ATTR_BYTES) {
    throw new ConnectionInboundRuntimeError("Mapped Service Object attrs exceed the bounded size.", "CONNECTION_MAPPING_ATTRS_TOO_LARGE", 413);
  }

  return {
    service_object: {
      object_type: text(source.object_type),
      ...(text(source.status) ? { status: text(source.status) } : {}),
      ...(codeValue !== null ? { code: text(codeValue) } : {}),
      ...(titleValue !== null ? { title: text(titleValue) } : {}),
      attrs,
    },
    task_type: text(mapping.task_type) || null,
  };
}

export {
  BODY_REF_PREFIX,
  MAX_BODY_PATH_SEGMENTS,
  MAX_MAPPING_DEPTH,
  MAX_MAPPING_NODES,
  MAX_PROJECTED_ATTR_BYTES,
  normalizeMappingMode,
  parseInboundJson,
  projectInboundServiceObject,
  validateInboundMappingConfig,
};
