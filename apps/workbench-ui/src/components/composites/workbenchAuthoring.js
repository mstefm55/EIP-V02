function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOptionalText(value) {
  const trimmed = normalizeText(value);
  return trimmed.length > 0 ? trimmed : "";
}

function parseJsonText(text, label) {
  const source = String(text ?? "").trim();
  if (!source) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(source) };
  } catch {
    return { ok: false, error: `${label} must be valid JSON.` };
  }
}

function prettyJson(value, fallback = {}) {
  const source = value && typeof value === "object" ? value : fallback;
  return JSON.stringify(source, null, 2);
}

function parseCommaList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasAuthoringPermission(session) {
  const permissions = Array.isArray(session?.permissions) ? session.permissions : [];
  return permissions.includes("PROCESS_DEF_WRITE") || permissions.includes("CRM_PROCESS_DEF_WRITE");
}

function buildTaskTemplateDraft(item, selected) {
  const attrs = item?.attrs && typeof item.attrs === "object" ? item.attrs : {};
  const allowedActions = Array.isArray(attrs.allowed_actions) ? attrs.allowed_actions : [];
  return {
    id: item?.id || null,
    isNew: !item?.id,
    process_def_id: item?.process_def_id || selected?.id || "",
    service_object_type: normalizeOptionalText(item?.service_object_type || selected?.object_type),
    task_type: normalizeOptionalText(item?.task_type),
    title: normalizeOptionalText(item?.title),
    description: normalizeOptionalText(item?.description),
    sort_order: Number.isFinite(item?.sort_order) ? item.sort_order : 100,
    is_active: item?.is_active !== false,
    allowed_actions_text: allowedActions.join(", "),
    completion_action: normalizeOptionalText(attrs.completion_action),
    attrs_text: Object.keys(attrs).length > 0 ? prettyJson(attrs) : "{}",
  };
}

function buildBindingDraft(item, selected) {
  const attrs = item?.attrs && typeof item.attrs === "object" ? item.attrs : {};
  return {
    id: item?.id || null,
    isNew: !item?.id,
    process_def_id: item?.process_def_id || selected?.id || "",
    service_object_type: normalizeOptionalText(item?.service_object_type || selected?.object_type),
    task_type: normalizeOptionalText(item?.task_type),
    priority: Number.isFinite(item?.priority) ? item.priority : 100,
    is_active: item?.is_active !== false,
    attrs_text: Object.keys(attrs).length > 0 ? prettyJson(attrs) : "{}",
  };
}

export {
  buildBindingDraft,
  buildTaskTemplateDraft,
  hasAuthoringPermission,
  normalizeOptionalText,
  normalizeText,
  parseCommaList,
  parseJsonText,
  prettyJson,
};
