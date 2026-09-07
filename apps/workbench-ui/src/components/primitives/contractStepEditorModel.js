const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;
const FIELD_TYPES = new Set([
  "text",
  "number",
  "checkbox",
  "select",
  "textarea",
  "password",
  "url",
  "email",
]);

function normalizeText(value) {
  return String(value ?? "").trim();
}

function safePathSegments(path) {
  const segments = normalizeText(path).split(".").filter(Boolean);
  if (!segments.length) return null;
  for (const segment of segments) {
    if (FORBIDDEN_KEYS.has(segment)) return null;
    if (!/^[A-Za-z0-9_:-]{1,80}$/.test(segment)) return null;
  }
  return segments;
}

export function getSafePath(source, path) {
  const segments = safePathSegments(path);
  if (!segments) return undefined;
  let cursor = source;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

export function setSafePath(source, path, value) {
  const segments = safePathSegments(path);
  if (!segments) throw new Error("UI_STEP_EDITOR_PATH_INVALID");
  const root = source && typeof source === "object" && !Array.isArray(source) ? structuredClone(source) : {};
  let cursor = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = cursor[segment];
    cursor[segment] = next && typeof next === "object" && !Array.isArray(next) ? { ...next } : {};
    cursor = cursor[segment];
  }
  cursor[segments[segments.length - 1]] = value;
  return root;
}

function normalizeOption(rawOption) {
  if (typeof rawOption === "string") {
    const value = normalizeText(rawOption);
    return value ? { value, label: value } : null;
  }
  if (!rawOption || typeof rawOption !== "object" || Array.isArray(rawOption)) return null;
  const value = normalizeText(rawOption.value ?? rawOption.code);
  if (!value) return null;
  const label = normalizeText(rawOption.label) || value;
  return { value, label };
}

export function normalizeStepEditorField(rawField) {
  if (!rawField || typeof rawField !== "object" || Array.isArray(rawField)) return null;
  const key = normalizeText(rawField.key);
  if (!FIELD_KEY_PATTERN.test(key) || FORBIDDEN_KEYS.has(key)) return null;
  const path = normalizeText(rawField.path || key);
  if (!safePathSegments(path)) return null;
  const requestedType = normalizeText(rawField.type).toLowerCase();
  const type = FIELD_TYPES.has(requestedType) ? requestedType : "text";
  const options = Array.isArray(rawField.options)
    ? rawField.options.map(normalizeOption).filter(Boolean).slice(0, 100)
    : [];

  return {
    key,
    path,
    label: normalizeText(rawField.label) || key,
    type,
    required: rawField.required === true,
    advanced: rawField.advanced === true,
    placeholder: normalizeText(rawField.placeholder),
    help: normalizeText(rawField.help),
    rows: Math.max(2, Math.min(12, Number(rawField.rows) || 4)),
    options,
    default_value: rawField.default_value,
    omit_empty: rawField.omit_empty === true,
  };
}

export function normalizeStepEditorFields(rawFields, options = {}) {
  const maxFields = Math.max(1, Math.min(128, Number(options.maxFields) || 64));
  const input = Array.isArray(rawFields) ? rawFields.slice(0, maxFields) : [];
  const output = [];
  const seen = new Set();
  for (const rawField of input) {
    const field = normalizeStepEditorField(rawField);
    if (!field || seen.has(field.key)) continue;
    seen.add(field.key);
    output.push(field);
  }
  return output;
}

function toDraftValue(field, rawValue) {
  if (rawValue === undefined || rawValue === null) {
    if (field.type === "checkbox") return Boolean(field.default_value);
    if (field.type === "number") {
      const numericDefault = Number(field.default_value);
      return Number.isFinite(numericDefault) ? numericDefault : 0;
    }
    return field.default_value ?? "";
  }
  if (field.type === "checkbox") return rawValue === true;
  if (field.type === "number") {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return String(rawValue);
}

export function buildStepEditorDraft(record, fields) {
  const output = {};
  for (const field of Array.isArray(fields) ? fields : []) {
    output[field.key] = toDraftValue(field, getSafePath(record, field.path));
  }
  return output;
}

export function validateStepEditorDraft(draft, fields) {
  const errors = [];
  for (const field of Array.isArray(fields) ? fields : []) {
    if (!field.required) continue;
    const value = draft?.[field.key];
    if (field.type === "checkbox") continue;
    if (value === null || value === undefined || String(value).trim() === "") {
      errors.push({ key: field.key, message: `${field.label} is required.` });
    }
  }
  return errors;
}

export function patchRecordFromStepDraft(baseRecord, draft, fields) {
  let output = baseRecord && typeof baseRecord === "object" && !Array.isArray(baseRecord)
    ? structuredClone(baseRecord)
    : {};

  for (const field of Array.isArray(fields) ? fields : []) {
    if (!Object.prototype.hasOwnProperty.call(draft || {}, field.key)) continue;
    let value = draft[field.key];
    if (field.type === "number") {
      const parsed = Number(value);
      value = Number.isFinite(parsed) ? parsed : 0;
    } else if (field.type === "checkbox") {
      value = value === true;
    }
    if (field.omit_empty && (value === null || value === undefined || String(value).trim() === "")) {
      continue;
    }
    output = setSafePath(output, field.path, value);
  }

  return output;
}

export const CONTRACT_STEP_EDITOR_FIELD_TYPES = Object.freeze([...FIELD_TYPES]);
