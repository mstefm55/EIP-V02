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
  "string_list",
  "json_object",
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
  const optionsPath = normalizeText(rawField.options_path);

  return {
    key,
    path,
    label: normalizeText(rawField.label) || key,
    type,
    required: rawField.required === true,
    advanced: rawField.advanced === true,
    placeholder: normalizeText(rawField.placeholder),
    help: normalizeText(rawField.help),
    rows: Math.max(2, Math.min(16, Number(rawField.rows) || 4)),
    options,
    options_path: optionsPath && safePathSegments(optionsPath) ? optionsPath : "",
    option_value_key: normalizeText(rawField.option_value_key || "code") || "code",
    option_label_key: normalizeText(rawField.option_label_key || "label") || "label",
    default_value: rawField.default_value,
    omit_empty: rawField.omit_empty === true,
    immutable_after_create: rawField.immutable_after_create === true,
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

export function resolveStepEditorFieldOptions(field, optionsPayload) {
  if (!field) return [];
  const remote = field.options_path ? getSafePath(optionsPayload, field.options_path) : null;
  if (!Array.isArray(remote)) return field.options || [];

  const options = [];
  const seen = new Set();
  for (const entry of remote.slice(0, 200)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const value = normalizeText(entry[field.option_value_key]);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      label: normalizeText(entry[field.option_label_key]) || value,
    });
  }
  return options.length > 0 ? options : field.options || [];
}

function normalizeStringList(value) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[\n,]+/);
  const output = [];
  const seen = new Set();
  for (const entry of source) {
    const text = normalizeText(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ok: true, value };
  }
  const source = String(value ?? "").trim();
  if (!source) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, value: null };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, value: null };
  }
}

function toDraftValue(field, rawValue) {
  // Secret/password inputs are write-only in the UI. Even if an unsafe backend
  // accidentally includes a value, never project it back into the form.
  if (field.type === "password") return "";

  if (field.type === "string_list") {
    const value = rawValue === undefined || rawValue === null ? field.default_value : rawValue;
    return normalizeStringList(value).join("\n");
  }

  if (field.type === "json_object") {
    const value = rawValue === undefined || rawValue === null ? field.default_value : rawValue;
    const parsed = parseJsonObject(value);
    return JSON.stringify(parsed.ok ? parsed.value : {}, null, 2);
  }

  if (rawValue === undefined || rawValue === null || rawValue === "") {
    if (field.type === "checkbox") return Boolean(field.default_value);
    if (field.type === "number") {
      if (field.default_value === undefined || field.default_value === null || field.default_value === "") return "";
      const numericDefault = Number(field.default_value);
      return Number.isFinite(numericDefault) ? numericDefault : "";
    }
    return field.default_value ?? "";
  }
  if (field.type === "checkbox") return rawValue === true;
  if (field.type === "number") {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : "";
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
    const value = draft?.[field.key];
    if (field.required && field.type !== "checkbox") {
      if (value === null || value === undefined || String(value).trim() === "") {
        errors.push({ key: field.key, message: `${field.label} is required.` });
        continue;
      }
    }

    if (field.type === "json_object" && value !== null && value !== undefined && String(value).trim() !== "") {
      const parsed = parseJsonObject(value);
      if (!parsed.ok) {
        errors.push({ key: field.key, message: `${field.label} must be a JSON object.` });
      }
    }
  }
  return errors;
}

export function patchRecordFromStepDraft(baseRecord, draft, fields, options = {}) {
  let output = baseRecord && typeof baseRecord === "object" && !Array.isArray(baseRecord)
    ? structuredClone(baseRecord)
    : {};
  const isCreate = options.isCreate === true;

  for (const field of Array.isArray(fields) ? fields : []) {
    if (!Object.prototype.hasOwnProperty.call(draft || {}, field.key)) continue;
    if (!isCreate && field.immutable_after_create) continue;
    let value = draft[field.key];

    if (
      field.omit_empty
      && (value === null || value === undefined || (typeof value !== "object" && String(value).trim() === ""))
    ) {
      continue;
    }

    if (field.type === "number") {
      if (value === "" || value === null || value === undefined) continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) continue;
      value = parsed;
    } else if (field.type === "checkbox") {
      value = value === true;
    } else if (field.type === "string_list") {
      value = normalizeStringList(value);
    } else if (field.type === "json_object") {
      const parsed = parseJsonObject(value);
      if (!parsed.ok) continue;
      value = parsed.value;
    }
    if (field.omit_empty) {
      const isEmptyList = Array.isArray(value) && value.length === 0;
      const isEmptyObject = value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
      const isEmptyScalar = value === null || value === undefined || (typeof value !== "object" && String(value).trim() === "");
      if (isEmptyList || isEmptyObject || isEmptyScalar) continue;
    }
    output = setSafePath(output, field.path, value);
  }

  return output;
}

export const CONTRACT_STEP_EDITOR_FIELD_TYPES = Object.freeze([...FIELD_TYPES]);
