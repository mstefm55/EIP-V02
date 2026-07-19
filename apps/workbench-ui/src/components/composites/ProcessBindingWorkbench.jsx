import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, describeApiError } from "../../services/apiClient.js";
import { resolveContract } from "../../engine/contracts.js";
import StateNotice from "../primitives/StateNotice.jsx";
import {
  buildBindingDraft,
  hasAuthoringPermission,
  parseJsonText,
} from "./workbenchAuthoring.js";

function ProcessBindingWorkbench({ node, ctx }) {
  const listContract = node?.props?.list_contract || null;
  const createContract = node?.props?.create_contract || null;
  const updateContract = node?.props?.update_contract || null;
  const sectionTitle = node?.props?.title || "Process Binding Workbench";
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
        setError("Binding list contract could not be resolved.");
        return;
      }
      const payload = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      if (loadTokenRef.current !== loadToken) return;

      const nextItems = Array.isArray(payload?.items) ? payload.items : [];
      setItems(nextItems);
      if (nextItems.length > 0) {
        const preferred = nextItems.find((item) => item.id === activeId) || nextItems[0];
        setActiveId(preferred.id);
        setDraft(buildBindingDraft(preferred, selected));
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
      setError(describeApiError(err, "Failed to load process bindings."));
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
    const next = buildBindingDraft(null, selected);
    next.isNew = true;
    setDraft(next);
    setActiveId(null);
    setStatus(null);
  }, [selected, selectedId]);

  const choose = useCallback((item) => {
    setActiveId(item.id);
    setDraft(buildBindingDraft(item, selected));
    setStatus(null);
  }, [selected]);

  const patchDraft = useCallback((field, value) => {
    setDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const save = useCallback(async () => {
    if (!selectedId || !draft) return;
    if (!canAuthor) {
      setStatus("Missing write permission for binding authoring.");
      return;
    }
    if (!draft.service_object_type) {
      setStatus("Service object type is required.");
      return;
    }
    const attrsParsed = parseJsonText(draft.attrs_text, "Binding attrs");
    if (!attrsParsed.ok) {
      setStatus(attrsParsed.error);
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      const contract = draft.isNew ? createContract : updateContract;
      const resolved = resolveContract(contract, contractCtx, {
        pathParams: { id: draft.id || undefined },
      });
      if (!resolved) {
        setStatus("Binding save contract could not be resolved.");
        return;
      }
      const payload = {
        process_def_id: selectedId,
        service_object_type: draft.service_object_type,
        task_type: draft.task_type || undefined,
        priority: Number(draft.priority) || 100,
        is_active: draft.is_active === true,
        attrs: attrsParsed.value && typeof attrsParsed.value === "object" ? attrsParsed.value : {},
      };
      const response = await apiFetch(resolved.pathWithQuery, {
        method: resolved.method,
        body: payload,
      });
      const saved = response?.item || null;
      if (saved?.id) {
        setActiveId(saved.id);
      }
      setStatus(draft.isNew ? "Binding created." : "Binding updated.");
      refreshWorkbench?.();
      await load();
    } catch (err) {
      setStatus(describeApiError(err, "Failed to save process binding."));
    } finally {
      setSaving(false);
    }
  }, [canAuthor, contractCtx, createContract, draft, load, refreshWorkbench, selectedId, updateContract]);

  const deactivate = useCallback(async () => {
    if (!draft) return;
    if (draft.isNew) {
      setDraft(null);
      setStatus("Draft binding removed.");
      return;
    }
    if (!canAuthor) {
      setStatus("Missing write permission for binding authoring.");
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      const resolved = resolveContract(updateContract, contractCtx, { pathParams: { id: draft.id } });
      if (!resolved) {
        setStatus("Binding update contract could not be resolved.");
        return;
      }
      await apiFetch(resolved.pathWithQuery, {
        method: resolved.method,
        body: { is_active: false },
      });
      setStatus("Binding deactivated.");
      refreshWorkbench?.();
      await load();
    } catch (err) {
      setStatus(describeApiError(err, "Failed to deactivate binding."));
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
        <StateNotice title="Select a process definition to author bindings." />
      ) : null}
      {loading ? <StateNotice title="Loading process bindings..." /> : null}
      {error ? <StateNotice kind="error" title="Binding error" message={error} /> : null}
      {status ? <StateNotice title={status} /> : null}

      {!loading && !error && selectedId ? (
        <div className="authoring-layout">
          <div className="list-panel">
            {items.length === 0 ? <StateNotice title="No process bindings found." /> : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === activeId ? "list-item active" : "list-item"}
                onClick={() => choose(item)}
              >
                <strong>{item.service_object_type || "-"}</strong>
                <span>{item.task_type || "All tasks"}</span>
              </button>
            ))}
          </div>

          <div className="editor-panel">
            {draft ? (
              <div className="stack">
                <div className="form-grid">
                  <label className="form-field">
                    <span>Service Object Type</span>
                    <input
                      aria-label="Service Object Type"
                      value={draft.service_object_type}
                      onChange={(event) => patchDraft("service_object_type", event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    <span>Task Type</span>
                    <input
                      aria-label="Task Type"
                      value={draft.task_type}
                      onChange={(event) => patchDraft("task_type", event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    <span>Priority</span>
                    <input
                      aria-label="Priority"
                      type="number"
                      value={draft.priority}
                      onChange={(event) => patchDraft("priority", Number(event.target.value || 100))}
                    />
                  </label>
                </div>

                <label className="form-field">
                  <span>Attrs (JSON)</span>
                  <textarea
                    aria-label="Attrs (JSON)"
                    rows={6}
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
              <StateNotice title="Choose a binding or start a new one." />
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default ProcessBindingWorkbench;
