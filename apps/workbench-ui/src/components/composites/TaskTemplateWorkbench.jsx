import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, describeApiError } from "../../services/apiClient.js";
import { resolveContract } from "../../engine/contracts.js";
import StateNotice from "../primitives/StateNotice.jsx";
import {
  buildTaskTemplateDraft,
  hasAuthoringPermission,
  parseCommaList,
  parseJsonText,
} from "./workbenchAuthoring.js";

function TaskTemplateWorkbench({ node, ctx }) {
  const listContract = node?.props?.list_contract || null;
  const createContract = node?.props?.create_contract || null;
  const updateContract = node?.props?.update_contract || null;
  const sectionTitle = node?.props?.title || "Task Template Workbench";
  const sectionEyebrow = node?.props?.eyebrow || "Workbench Contract";
  const selected = ctx?.selection?.definition || null;
  const selectedId = selected?.id || null;
  const canAuthor = hasAuthoringPermission(ctx?.auth?.session);
  const refreshWorkbench = ctx?.workbench?.refresh;
  const contractCtx = useMemo(() => ({
    surfaceProps: ctx?.surfaceProps || {},
    selection: {
      definition: ctx?.selection?.definition || {},
    },
    auth: {
      session: ctx?.auth?.session || {},
    },
  }), [ctx?.auth?.session, ctx?.selection?.definition, ctx?.surfaceProps]);

  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const loadTokenRef = useRef(0);

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
      const resolved = resolveContract(listContract, contractCtx, {
        query: { process_def_id: selectedId },
      });
      if (!resolved) {
        setItems([]);
        setDraft(null);
        setError("Task-template list contract could not be resolved.");
        return;
      }

      const payload = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      if (loadTokenRef.current !== loadToken) return;

      const nextItems = Array.isArray(payload?.items) ? payload.items : [];
      setItems(nextItems);
      if (nextItems.length > 0) {
        const preferred = nextItems.find((item) => item.id === activeId) || nextItems[0];
        setActiveId(preferred.id);
        setDraft(buildTaskTemplateDraft(preferred, selected));
      } else {
        setActiveId(null);
        setDraft((prev) => {
          if (prev?.isNew && prev.process_def_id === selectedId) {
            return prev;
          }
          return null;
        });
      }
    } catch (err) {
      if (loadTokenRef.current !== loadToken) return;
      setItems([]);
      setDraft(null);
      setError(describeApiError(err, "Failed to load task templates."));
    } finally {
      if (loadTokenRef.current === loadToken) {
        setLoading(false);
      }
    }
  }, [activeId, contractCtx, listContract, selected, selectedId]);

  useEffect(() => {
    load();
  }, [load, selectedId]);

  const startNew = useCallback(() => {
    if (!selectedId) return;
    const next = buildTaskTemplateDraft(null, selected);
    next.isNew = true;
    setDraft(next);
    setActiveId(null);
    setStatus(null);
  }, [selected, selectedId]);

  const choose = useCallback((item) => {
    setActiveId(item.id);
    setDraft(buildTaskTemplateDraft(item, selected));
    setStatus(null);
  }, [selected]);

  const patchDraft = useCallback((field, value) => {
    setDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const save = useCallback(async () => {
    if (!selectedId || !draft) return;
    if (!canAuthor) {
      setStatus("Missing write permission for task-template authoring.");
      return;
    }
    if (!draft.task_type) {
      setStatus("Task type is required.");
      return;
    }

    const attrsParsed = parseJsonText(draft.attrs_text, "Template attrs");
    if (!attrsParsed.ok) {
      setStatus(attrsParsed.error);
      return;
    }
    const attrs = attrsParsed.value && typeof attrsParsed.value === "object" ? { ...attrsParsed.value } : {};
    attrs.allowed_actions = parseCommaList(draft.allowed_actions_text);
    if (draft.completion_action) {
      attrs.completion_action = draft.completion_action;
    } else {
      delete attrs.completion_action;
    }

    setSaving(true);
    setStatus(null);
    try {
      const contract = draft.isNew ? createContract : updateContract;
      const resolved = resolveContract(contract, contractCtx, { pathParams: { id: draft.id || undefined } });
      if (!resolved) {
        setStatus("Template save contract could not be resolved.");
        return;
      }

      const payload = {
        process_def_id: selectedId,
        service_object_type: draft.service_object_type || selected?.object_type || undefined,
        task_type: draft.task_type,
        title: draft.title || undefined,
        description: draft.description || undefined,
        sort_order: Number(draft.sort_order) || 100,
        is_active: draft.is_active === true,
        attrs,
      };

      const response = await apiFetch(resolved.pathWithQuery, {
        method: resolved.method,
        body: payload,
      });
      const saved = response?.item || null;
      if (saved?.id) {
        setActiveId(saved.id);
      }
      setStatus(draft.isNew ? "Task template created." : "Task template updated.");
      refreshWorkbench?.();
      await load();
    } catch (err) {
      setStatus(describeApiError(err, "Failed to save task template."));
    } finally {
      setSaving(false);
    }
  }, [canAuthor, contractCtx, createContract, draft, load, refreshWorkbench, selected?.object_type, selectedId, updateContract]);

  const deactivate = useCallback(async () => {
    if (!draft) return;
    if (draft.isNew) {
      setDraft(null);
      setStatus("Draft template removed.");
      return;
    }
    if (!canAuthor) {
      setStatus("Missing write permission for task-template authoring.");
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      const resolved = resolveContract(updateContract, contractCtx, { pathParams: { id: draft.id } });
      if (!resolved) {
        setStatus("Template update contract could not be resolved.");
        return;
      }
      await apiFetch(resolved.pathWithQuery, {
        method: resolved.method,
        body: { is_active: false },
      });
      setStatus("Task template deactivated.");
      refreshWorkbench?.();
      await load();
    } catch (err) {
      setStatus(describeApiError(err, "Failed to deactivate task template."));
    } finally {
      setSaving(false);
    }
  }, [canAuthor, contractCtx, draft, load, refreshWorkbench, updateContract]);

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{sectionEyebrow}</p>
          <h3>{sectionTitle}</h3>
        </div>
        <div className="inline-actions">
          <button type="button" className="ghost-button" onClick={startNew} disabled={!selectedId || !canAuthor}>
            New
          </button>
          <button type="button" className="ghost-button" onClick={load} disabled={!selectedId || loading}>
            Refresh
          </button>
          <button type="button" className="primary-button" onClick={save} disabled={!draft || saving || !canAuthor}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" className="ghost-button" onClick={deactivate} disabled={!draft || saving || !canAuthor}>
            Deactivate
          </button>
        </div>
      </div>

      {!selectedId ? (
        <StateNotice title="Select a process definition to author task templates." />
      ) : null}
      {loading ? <StateNotice title="Loading task templates..." /> : null}
      {error ? <StateNotice kind="error" title="Task-template error" message={error} /> : null}
      {status ? <StateNotice title={status} /> : null}

      {!loading && !error && selectedId ? (
        <div className="authoring-layout">
          <div className="list-panel">
            {items.length === 0 ? <StateNotice title="No task templates found." /> : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === activeId ? "list-item active" : "list-item"}
                onClick={() => choose(item)}
              >
                <strong>{item.task_type || "-"}</strong>
                <span>{item.title || "-"}</span>
              </button>
            ))}
          </div>

          <div className="editor-panel">
            {draft ? (
              <div className="stack">
                <div className="form-grid">
                  <label className="form-field">
                    <span>Task Type</span>
                    <input
                      aria-label="Task Type"
                      value={draft.task_type}
                      onChange={(event) => patchDraft("task_type", event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    <span>Service Object Type</span>
                    <input
                      aria-label="Service Object Type"
                      value={draft.service_object_type}
                      onChange={(event) => patchDraft("service_object_type", event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    <span>Title</span>
                    <input
                      aria-label="Title"
                      value={draft.title}
                      onChange={(event) => patchDraft("title", event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    <span>Sort Order</span>
                    <input
                      aria-label="Sort Order"
                      type="number"
                      value={draft.sort_order}
                      onChange={(event) => patchDraft("sort_order", Number(event.target.value || 100))}
                    />
                  </label>
                </div>

                <label className="form-field">
                  <span>Description</span>
                  <textarea
                    aria-label="Description"
                    rows={3}
                    value={draft.description}
                    onChange={(event) => patchDraft("description", event.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Allowed Actions (comma separated)</span>
                  <input
                    aria-label="Allowed Actions (comma separated)"
                    value={draft.allowed_actions_text}
                    onChange={(event) => patchDraft("allowed_actions_text", event.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Completion Action</span>
                  <input
                    aria-label="Completion Action"
                    value={draft.completion_action}
                    onChange={(event) => patchDraft("completion_action", event.target.value)}
                  />
                </label>

                <label className="form-field">
                  <span>Attrs (JSON)</span>
                  <textarea
                    aria-label="Attrs (JSON)"
                    rows={5}
                    value={draft.attrs_text}
                    onChange={(event) => patchDraft("attrs_text", event.target.value)}
                  />
                </label>

                <label className="form-toggle">
                  <input
                    type="checkbox"
                    checked={draft.is_active}
                    onChange={(event) => patchDraft("is_active", event.target.checked)}
                  />
                  <span>Active</span>
                </label>
              </div>
            ) : (
              <StateNotice title="Choose a task template or start a new one." />
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default TaskTemplateWorkbench;
