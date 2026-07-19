import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, describeApiError } from "../../services/apiClient.js";
import { getPath, resolveContract, resolveValue } from "../../engine/contracts.js";
import StateNotice from "./StateNotice.jsx";

function hasAnyPermission(session, expected = []) {
  if (!Array.isArray(expected) || expected.length === 0) return true;
  const granted = Array.isArray(session?.permissions) ? session.permissions : [];
  return expected.some((permission) => granted.includes(permission));
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function parseCommaList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function toNumberOrDefault(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  return fallback;
}

function normalizeField(rawField) {
  if (!rawField || typeof rawField !== "object") return null;
  const key = String(rawField.key || "").trim();
  if (!key) return null;
  const type = String(rawField.type || "text").trim() || "text";
  return {
    key,
    label: String(rawField.label || key).trim() || key,
    type,
    required: rawField.required === true,
    rows: Number.isFinite(rawField.rows) ? rawField.rows : undefined,
    default_value: rawField.default_value,
    default_token: rawField.default_token,
    placeholder: rawField.placeholder,
  };
}

function prettyJson(value, fallback = {}) {
  const source = value && typeof value === "object" ? value : fallback;
  return JSON.stringify(source, null, 2);
}

function applyReadTransform(rawValue, transform, fallback, fieldType) {
  if (transform === "array_csv") {
    return Array.isArray(rawValue) ? rawValue.join(", ") : "";
  }
  if (transform === "json_pretty_or_default") {
    return prettyJson(rawValue, fallback && typeof fallback === "object" ? fallback : {});
  }
  if (transform === "number") {
    return toNumberOrDefault(rawValue, Number.isFinite(fallback) ? fallback : 0);
  }
  if (transform === "bool") {
    return toBoolean(rawValue);
  }

  if (rawValue === undefined || rawValue === null) {
    if (fieldType === "checkbox") return toBoolean(fallback);
    if (fieldType === "json") return String(fallback ?? "{}");
    if (fieldType === "number") return Number.isFinite(fallback) ? fallback : 0;
    return String(fallback ?? "");
  }

  if (fieldType === "checkbox") return toBoolean(rawValue);
  if (fieldType === "json") return typeof rawValue === "string" ? rawValue : prettyJson(rawValue, {});
  if (fieldType === "number") return toNumberOrDefault(rawValue, Number.isFinite(fallback) ? fallback : 0);
  return String(rawValue);
}

function applyWriteTransform(rawValue, transform, options = {}) {
  if (transform === "comma_list") return parseCommaList(rawValue);
  if (transform === "number") return toNumberOrDefault(rawValue, options.fallback ?? 0);
  if (transform === "bool") return toBoolean(rawValue);
  return rawValue;
}

function humanize(value) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toBusinessEyebrow(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  const normalized = text.toLowerCase();
  if (normalized.includes("ui engine")) return "Record Management";
  if (normalized.includes("workbench contract")) return "Record Management";
  return text;
}

function normalizeEditorConfig(props = {}) {
  const fields = Array.isArray(props.fields) ? props.fields.map((field) => normalizeField(field)).filter(Boolean) : [];
  return {
    title: props.title || "Record Editor",
    eyebrow: toBusinessEyebrow(props.eyebrow, "Record Management"),
    selection_required_path: props.selection_required_path || "selection.definition.id",
    selection_required_message: props.selection_required_message || "Select a record before editing.",
    permissions_any: Array.isArray(props.permissions_any) ? props.permissions_any : [],
    read_only_message: props.read_only_message || "This session is read-only for this panel.",
    list_contract: props.list_contract || null,
    create_contract: props.create_contract || null,
    update_contract: props.update_contract || null,
    list_view: {
      id_key: props.list_view?.id_key || "id",
      title_field: props.list_view?.title_field || "id",
      subtitle_field: props.list_view?.subtitle_field || "",
      empty_subtitle: props.list_view?.empty_subtitle || "-",
      empty_list_message: props.list_view?.empty_list_message || "No records found.",
      empty_editor_message: props.list_view?.empty_editor_message || "Choose a record or create a new one.",
    },
    fields,
    item_mapping: Array.isArray(props.item_mapping) ? props.item_mapping : [],
    save_payload: props.save_payload || {},
    deactivate_payload: props.deactivate_payload || { is_active: false },
    loading_message: props.loading_message || "Loading records...",
    error_title: props.error_title || "Editor error",
    actions: {
      new_label: props.actions?.new_label || "New",
      refresh_label: props.actions?.refresh_label || "Refresh",
      save_label: props.actions?.save_label || "Save",
      save_busy_label: props.actions?.save_busy_label || "Saving...",
      deactivate_label: props.actions?.deactivate_label || "Deactivate",
    },
  };
}

function buildScopes(ctx, draft = null) {
  return {
    surface: ctx?.surfaceProps || {},
    surface_meta: ctx?.surfaceMeta || {},
    available_surfaces: ctx?.availableSurfaces || [],
    selection: ctx?.selection?.definition || {},
    auth: ctx?.auth?.session || {},
    draft: draft || {},
  };
}

function buildEmptyDraft(config, ctx) {
  const scopes = buildScopes(ctx, {});
  const draft = {};

  for (const field of config.fields) {
    let value = field.default_value;
    if (field.default_token) {
      value = resolveValue(field.default_token, scopes);
    }
    if (value === undefined) {
      if (field.type === "checkbox") value = false;
      else if (field.type === "json") value = "{}";
      else if (field.type === "number") value = 0;
      else value = "";
    }
    draft[field.key] = applyReadTransform(value, null, field.default_value, field.type);
  }

  return draft;
}

function buildDraftFromItem(config, ctx, item) {
  const draft = buildEmptyDraft(config, ctx);
  const mappings = Array.isArray(config.item_mapping) ? config.item_mapping : [];
  const mappingByField = new Map(mappings.map((mapping) => [mapping.field, mapping]));

  for (const field of config.fields) {
    const mapping = mappingByField.get(field.key);
    const sourcePath = mapping?.from || field.key;
    const raw = getPath(item, sourcePath);
    const fallback = mapping?.default_value ?? field.default_value;
    const transformed = applyReadTransform(raw, mapping?.transform, fallback, field.type);
    draft[field.key] = transformed;
  }

  return draft;
}

function parseJsonField(value, label) {
  const source = String(value ?? "").trim();
  if (!source) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(source) };
  } catch {
    return { ok: false, error: `${label} must be valid JSON.` };
  }
}

function applyNumericAndBooleanRules(payload, saveConfig) {
  const output = { ...payload };
  const numberFields = Array.isArray(saveConfig.number_fields) ? saveConfig.number_fields : [];
  const booleanFields = Array.isArray(saveConfig.boolean_fields) ? saveConfig.boolean_fields : [];

  for (const field of numberFields) {
    if (Object.prototype.hasOwnProperty.call(output, field)) {
      output[field] = toNumberOrDefault(output[field], 0);
    }
  }
  for (const field of booleanFields) {
    if (Object.prototype.hasOwnProperty.call(output, field)) {
      output[field] = toBoolean(output[field]);
    }
  }

  const omitEmptyFields = Array.isArray(saveConfig.omit_empty_fields) ? saveConfig.omit_empty_fields : [];
  for (const field of omitEmptyFields) {
    if (isBlank(output[field])) {
      delete output[field];
    }
  }

  return output;
}

function buildSavePayload(config, ctx, draft) {
  const saveConfig = config.save_payload || {};
  const scopes = buildScopes(ctx, draft);
  const resolvedTemplate = resolveValue(saveConfig.template || {}, scopes);
  const payload = applyNumericAndBooleanRules(resolvedTemplate, saveConfig);

  const attrsConfig = saveConfig.attrs || null;
  if (attrsConfig && typeof attrsConfig === "object") {
    const jsonFieldKey = String(attrsConfig.json_field || "").trim();
    let attrs = {};
    if (jsonFieldKey) {
      const fieldLabel =
        config.fields.find((field) => field.key === jsonFieldKey)?.label || humanize(jsonFieldKey);
      const parsed = parseJsonField(draft?.[jsonFieldKey], fieldLabel);
      if (!parsed.ok) return parsed;
      attrs = parsed.value && typeof parsed.value === "object" ? { ...parsed.value } : {};
    }

    const merges = Array.isArray(attrsConfig.merges) ? attrsConfig.merges : [];
    for (const merge of merges) {
      const target = String(merge?.target || "").trim();
      if (!target) continue;

      const raw = typeof merge.from === "string" ? resolveValue(merge.from, scopes) : merge.from;
      const transformed = applyWriteTransform(raw, merge?.transform, {
        fallback: merge?.fallback,
      });

      if (merge?.omit_empty && isBlank(transformed)) {
        delete attrs[target];
        continue;
      }
      attrs[target] = transformed;
    }

    payload[attrsConfig.target || "attrs"] = attrs;
  }

  return { ok: true, value: payload };
}

function ContractRecordEditor({ node, ctx }) {
  const configKey = JSON.stringify(node?.props || {});
  const config = useMemo(() => normalizeEditorConfig(node?.props || {}), [configKey]);
  const selectionValue = getPath(ctx, config.selection_required_path);
  const selectedId = selectionValue || null;
  const canAuthor = hasAnyPermission(ctx?.auth?.session, config.permissions_any);
  const refreshWorkbench = ctx?.workbench?.refresh;

  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const loadTokenRef = useRef(0);
  const activeIdRef = useRef(activeId);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const contractCtx = useMemo(
    () => ({
      surfaceProps: ctx?.surfaceProps || {},
      surfaceMeta: ctx?.surfaceMeta || {},
      availableSurfaces: ctx?.availableSurfaces || [],
      selection: {
        definition: ctx?.selection?.definition || {},
      },
      auth: {
        session: ctx?.auth?.session || {},
      },
    }),
    [ctx?.auth?.session, ctx?.availableSurfaces, ctx?.selection?.definition, ctx?.surfaceMeta, ctx?.surfaceProps]
  );

  const load = useCallback(async () => {
    const loadToken = loadTokenRef.current + 1;
    loadTokenRef.current = loadToken;

    if (!selectedId) {
      setItems([]);
      setActiveId(null);
      setDraft(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const resolved = resolveContract(config.list_contract, contractCtx);
      if (!resolved) {
        setItems([]);
        setDraft(null);
        setError("This panel is not configured yet.");
        return;
      }

      const payload = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      if (loadTokenRef.current !== loadToken) return;

      const nextItems = Array.isArray(payload?.items) ? payload.items : [];
      setItems(nextItems);

      if (nextItems.length > 0) {
        const preferred =
          nextItems.find((item) => item?.[config.list_view.id_key] === activeIdRef.current) ||
          nextItems[0];
        const preferredId = preferred?.[config.list_view.id_key] || null;
        setActiveId(preferredId);
        setDraft({
          ...buildDraftFromItem(config, contractCtx, preferred),
          __isNew: false,
          __selectionScope: selectedId,
          id: preferredId,
        });
      } else {
        setActiveId(null);
        setDraft((prev) => {
          if (prev?.__isNew && prev.__selectionScope === selectedId) {
            return prev;
          }
          return null;
        });
      }
    } catch (err) {
      if (loadTokenRef.current !== loadToken) return;
      setItems([]);
      setDraft(null);
      setError(describeApiError(err, "Failed to load records."));
    } finally {
      if (loadTokenRef.current === loadToken) {
        setLoading(false);
      }
    }
  }, [config, contractCtx, selectedId]);

  useEffect(() => {
    load();
  }, [load, selectedId, ctx?.workbench?.refreshNonce]);

  const patchDraft = useCallback((field, value) => {
    setDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const choose = useCallback(
    (item) => {
      const rowId = item?.[config.list_view.id_key] || null;
      setActiveId(rowId);
      setDraft({
        ...buildDraftFromItem(config, contractCtx, item),
        __isNew: false,
        __selectionScope: selectedId,
        id: rowId,
      });
      setStatus(null);
    },
    [config, contractCtx, selectedId]
  );

  const startNew = useCallback(() => {
    if (!selectedId) return;
    setActiveId(null);
    setDraft({
      ...buildEmptyDraft(config, contractCtx),
      __isNew: true,
      __selectionScope: selectedId,
      id: null,
    });
    setStatus(null);
  }, [config, contractCtx, selectedId]);

  const validateRequiredFields = useCallback(() => {
    for (const field of config.fields) {
      if (!field.required) continue;
      const value = draft?.[field.key];
      if (field.type === "checkbox") continue;
      if (isBlank(value)) {
        return `${field.label} is required.`;
      }
    }
    return null;
  }, [config.fields, draft]);

  const save = useCallback(async () => {
    if (!selectedId || !draft) return;
    if (!canAuthor) {
      setStatus(config.read_only_message);
      return;
    }

    const requiredError = validateRequiredFields();
    if (requiredError) {
      setStatus(requiredError);
      return;
    }

    const prepared = buildSavePayload(config, contractCtx, draft);
    if (!prepared.ok) {
      setStatus(prepared.error);
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      const contract = draft.__isNew ? config.create_contract : config.update_contract;
      const resolved = resolveContract(contract, contractCtx, {
        pathParams: { id: draft.id || undefined },
      });
      if (!resolved) {
        setStatus("Save settings are missing for this panel.");
        return;
      }

      const response = await apiFetch(resolved.pathWithQuery, {
        method: resolved.method,
        body: prepared.value,
      });
      const saved = response?.item || null;
      const savedId = saved?.[config.list_view.id_key] || saved?.id || null;
      if (savedId) {
        setActiveId(savedId);
      }
      setStatus(draft.__isNew ? "Record created." : "Record updated.");
      refreshWorkbench?.();
      await load();
    } catch (err) {
      setStatus(describeApiError(err, "Failed to save record."));
    } finally {
      setSaving(false);
    }
  }, [
    canAuthor,
    config,
    contractCtx,
    draft,
    load,
    refreshWorkbench,
    selectedId,
    validateRequiredFields,
  ]);

  const deactivate = useCallback(async () => {
    if (!draft) return;
    if (draft.__isNew) {
      setDraft(null);
      setStatus("Draft removed.");
      return;
    }
    if (!canAuthor) {
      setStatus(config.read_only_message);
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      const resolved = resolveContract(config.update_contract, contractCtx, {
        pathParams: { id: draft.id },
      });
      if (!resolved) {
        setStatus("Deactivate settings are missing for this panel.");
        return;
      }

      await apiFetch(resolved.pathWithQuery, {
        method: resolved.method,
        body: config.deactivate_payload,
      });
      setStatus("Record deactivated.");
      refreshWorkbench?.();
      await load();
    } catch (err) {
      setStatus(describeApiError(err, "Failed to deactivate record."));
    } finally {
      setSaving(false);
    }
  }, [
    canAuthor,
    config.deactivate_payload,
    config.read_only_message,
    config.update_contract,
    contractCtx,
    draft,
    load,
    refreshWorkbench,
  ]);

  const listTitleField = config.list_view.title_field;
  const listSubtitleField = config.list_view.subtitle_field;
  const textFields = config.fields.filter((field) => !["textarea", "json", "checkbox"].includes(field.type));
  const longFields = config.fields.filter((field) => ["textarea", "json"].includes(field.type));
  const toggleFields = config.fields.filter((field) => field.type === "checkbox");
  const showLoadingNotice = loading && items.length === 0 && !draft;

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{config.eyebrow}</p>
          <h3>{config.title}</h3>
        </div>
        <div className="inline-actions">
          <button type="button" className="ghost-button" onClick={startNew} disabled={!selectedId || !canAuthor}>
            {config.actions.new_label}
          </button>
          <button type="button" className="ghost-button" onClick={load} disabled={!selectedId || loading}>
            {config.actions.refresh_label}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={save}
            disabled={!draft || saving || !canAuthor}
          >
            {saving ? config.actions.save_busy_label : config.actions.save_label}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={deactivate}
            disabled={!draft || saving || !canAuthor}
          >
            {config.actions.deactivate_label}
          </button>
        </div>
      </div>

      {!canAuthor ? <StateNotice kind="warning" title={config.read_only_message} /> : null}
      {!selectedId ? <StateNotice title={config.selection_required_message} /> : null}
      {showLoadingNotice ? <StateNotice title={config.loading_message} /> : null}
      {error ? <StateNotice kind="error" title={config.error_title} message={error} /> : null}
      {status ? <StateNotice title={status} /> : null}

      {!loading && !error && selectedId ? (
        <div className="authoring-layout">
          <div className="list-panel">
            {items.length === 0 ? <StateNotice title={config.list_view.empty_list_message} /> : null}
            {items.map((item) => {
              const rowId = item?.[config.list_view.id_key] || item?.id;
              const title = item?.[listTitleField] || "-";
              const subtitle = listSubtitleField
                ? item?.[listSubtitleField] || config.list_view.empty_subtitle
                : config.list_view.empty_subtitle;
              return (
                <button
                  key={rowId}
                  type="button"
                  className={rowId === activeId ? "list-item active" : "list-item"}
                  onClick={() => choose(item)}
                >
                  <strong>{title}</strong>
                  <span>{subtitle}</span>
                </button>
              );
            })}
          </div>

          <div className="editor-panel">
            {draft ? (
              <div className="stack">
                {textFields.length > 0 ? (
                  <div className="form-grid">
                    {textFields.map((field) => (
                      <label key={field.key} className="form-field">
                        <span>{field.label}</span>
                        <input
                          aria-label={field.label}
                          type={field.type === "number" ? "number" : "text"}
                          placeholder={field.placeholder || ""}
                          value={draft[field.key] ?? ""}
                          onChange={(event) => {
                            const raw = event.target.value;
                            patchDraft(
                              field.key,
                              field.type === "number" ? toNumberOrDefault(raw, 0) : raw
                            );
                          }}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}

                {longFields.map((field) => (
                  <label key={field.key} className="form-field">
                    <span>{field.label}</span>
                    <textarea
                      aria-label={field.label}
                      rows={field.rows || 4}
                      placeholder={field.placeholder || ""}
                      value={draft[field.key] ?? ""}
                      onChange={(event) => patchDraft(field.key, event.target.value)}
                    />
                  </label>
                ))}

                {toggleFields.map((field) => (
                  <label key={field.key} className="form-toggle">
                    <input
                      type="checkbox"
                      checked={toBoolean(draft[field.key])}
                      onChange={(event) => patchDraft(field.key, event.target.checked)}
                    />
                    <span>{field.label}</span>
                  </label>
                ))}
              </div>
            ) : (
              <StateNotice title={config.list_view.empty_editor_message} />
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default ContractRecordEditor;
