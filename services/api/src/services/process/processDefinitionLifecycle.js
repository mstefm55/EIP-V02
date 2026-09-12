const PROCESS_LIFECYCLE = Object.freeze({
  DRAFT: "draft",
  PUBLISHED: "published",
  ARCHIVED: "archived",
});

const VALID_LIFECYCLE = new Set(Object.values(PROCESS_LIFECYCLE));

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function cloneAttrs(attrs) {
  return attrs && typeof attrs === "object" && !Array.isArray(attrs)
    ? { ...attrs }
    : {};
}

export { PROCESS_LIFECYCLE };

export function resolveProcessLifecycle(attrs = {}) {
  const source = cloneAttrs(attrs);
  const explicit = normalizeText(source.lifecycle_status || source.lifecycleStatus);
  if (VALID_LIFECYCLE.has(explicit)) return explicit;
  if (source.is_published === true || source.isPublished === true) {
    return PROCESS_LIFECYCLE.PUBLISHED;
  }
  if (source.is_archived === true || source.isArchived === true) {
    return PROCESS_LIFECYCLE.ARCHIVED;
  }
  return PROCESS_LIFECYCLE.DRAFT;
}

export function isProcessDraft(attrs = {}) {
  return resolveProcessLifecycle(attrs) === PROCESS_LIFECYCLE.DRAFT;
}

export function isProcessPublished(attrs = {}) {
  return resolveProcessLifecycle(attrs) === PROCESS_LIFECYCLE.PUBLISHED;
}

export function isProcessArchived(attrs = {}) {
  return resolveProcessLifecycle(attrs) === PROCESS_LIFECYCLE.ARCHIVED;
}

export function assertProcessDraftMutable(attrs = {}) {
  const lifecycle = resolveProcessLifecycle(attrs);
  if (lifecycle === PROCESS_LIFECYCLE.DRAFT) {
    return { ok: true, lifecycle };
  }
  return {
    ok: false,
    lifecycle,
    error: lifecycle === PROCESS_LIFECYCLE.PUBLISHED
      ? "PROCESS_DEF_PUBLISHED_IMMUTABLE"
      : "PROCESS_DEF_ARCHIVED_IMMUTABLE",
  };
}

export function buildProcessDraftAttrs(attrs = {}, options = {}) {
  const next = cloneAttrs(attrs);
  delete next.isPublished;
  delete next.isArchived;
  delete next.lifecycleStatus;

  next.lifecycle_status = PROCESS_LIFECYCLE.DRAFT;
  next.is_published = false;
  delete next.is_archived;
  delete next.published_at;
  delete next.archived_at;

  if (options.revision_of_process_def_id) {
    next.revision_of_process_def_id = String(options.revision_of_process_def_id);
  }
  if (options.revision_of_version !== undefined && options.revision_of_version !== null) {
    next.revision_of_version = Number(options.revision_of_version);
  }
  return next;
}

export function buildProcessPublishedAttrs(attrs = {}, options = {}) {
  const next = cloneAttrs(attrs);
  delete next.isPublished;
  delete next.isArchived;
  delete next.lifecycleStatus;

  next.lifecycle_status = PROCESS_LIFECYCLE.PUBLISHED;
  next.is_published = true;
  delete next.is_archived;
  next.published_at = options.published_at || new Date().toISOString();
  if (options.published_by_identity_id) {
    next.published_by_identity_id = String(options.published_by_identity_id);
  }
  return next;
}

export function buildProcessArchivedAttrs(attrs = {}, options = {}) {
  const next = cloneAttrs(attrs);
  delete next.isPublished;
  delete next.isArchived;
  delete next.lifecycleStatus;

  next.lifecycle_status = PROCESS_LIFECYCLE.ARCHIVED;
  next.is_published = false;
  next.is_archived = true;
  next.archived_at = options.archived_at || new Date().toISOString();
  if (options.archived_by_identity_id) {
    next.archived_by_identity_id = String(options.archived_by_identity_id);
  }
  return next;
}

export function resolveNextProcessVersion(rows = [], processCode = null) {
  const targetCode = processCode == null ? null : String(processCode);
  let maxVersion = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (targetCode !== null && String(row?.code || "") !== targetCode) continue;
    const version = Number(row?.version);
    if (Number.isInteger(version) && version > maxVersion) maxVersion = version;
  }
  return maxVersion + 1;
}

export function processRuntimeEligibility(definition = {}) {
  const lifecycle = resolveProcessLifecycle(definition?.attrs || {});
  if (definition?.is_active !== true) {
    return { ok: false, lifecycle, error: "PROCESS_DEF_INACTIVE" };
  }
  if (lifecycle !== PROCESS_LIFECYCLE.PUBLISHED) {
    return {
      ok: false,
      lifecycle,
      error: lifecycle === PROCESS_LIFECYCLE.ARCHIVED
        ? "PROCESS_DEF_ARCHIVED"
        : "PROCESS_DEF_NOT_PUBLISHED",
    };
  }
  return { ok: true, lifecycle };
}
