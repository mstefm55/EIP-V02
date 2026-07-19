import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, describeApiError } from "../../services/apiClient.js";
import { resolveContract } from "../../engine/contracts.js";
import StateNotice from "../primitives/StateNotice.jsx";
import {
  hasAuthoringPermission,
  normalizeOptionalText,
  parseJsonText,
  prettyJson,
} from "./workbenchAuthoring.js";

function buildEmptyDraft(defaultModule) {
  return {
    id: null,
    code: "",
    name: "",
    version: 1,
    module: defaultModule || "",
    object_type: "",
    service_object_category: "",
    is_active: true,
    is_published: false,
    graph_initial_node: "",
    graph_nodes_text: "[]",
    graph_transitions_text: "[]",
    graph_macros_text: "{}",
    attrs_text: "{}",
  };
}

function draftFromItem(item, defaultModule) {
  const source = item && typeof item === "object" ? item : {};
  const attrs = source.attrs && typeof source.attrs === "object" ? source.attrs : {};
  const graph = source.graph && typeof source.graph === "object" ? source.graph : {};
  return {
    id: source.id || null,
    code: normalizeOptionalText(source.code),
    name: normalizeOptionalText(source.name),
    version: Number.isFinite(source.version) ? source.version : 1,
    module: normalizeOptionalText(attrs.module || defaultModule),
    object_type: normalizeOptionalText(graph.object_type || attrs.object_type),
    service_object_category: normalizeOptionalText(
      attrs.service_object_category || attrs.serviceObjectCategory
    ),
    is_active: source.is_active !== false,
    is_published:
      source.is_published === true || attrs.is_published === true || attrs.isPublished === true,
    graph_initial_node: normalizeOptionalText(graph.initial_node || graph.initialNode),
    graph_nodes_text: prettyJson(
      graph.nodes !== undefined ? graph.nodes : [],
      []
    ),
    graph_transitions_text: prettyJson(
      graph.transitions !== undefined ? graph.transitions : [],
      []
    ),
    graph_macros_text: prettyJson(
      graph.macros !== undefined ? graph.macros : {},
      {}
    ),
    attrs_text: prettyJson(attrs),
  };
}

function parseGraphSection(text, label, fallback) {
  const parsed = parseJsonText(text, label);
  if (!parsed.ok) return parsed;
  if (String(text || "").trim().length === 0) {
    return { ok: true, value: fallback };
  }
  return parsed;
}

function listEntries(values) {
  if (!Array.isArray(values) || values.length === 0) return "-";
  return values.map((item) => item.code).join(", ");
}

function ProcessDefinitionStudio({ node, ctx }) {
  const detailContract = node?.props?.detail_source || null;
  const createContract = node?.props?.create_contract || null;
  const saveContract = node?.props?.save_contract || null;
  const validateContract = node?.props?.validate_contract || null;
  const publishContract = node?.props?.publish_contract || null;
  const taxonomyContract = node?.props?.taxonomy_contract || null;
  const sectionTitle = node?.props?.title || "Definition Studio";
  const sectionEyebrow = node?.props?.eyebrow || "Workbench Contract";

  const selected = ctx?.selection?.definition || null;
  const selectedId = selected?.id || null;
  const canAuthor = hasAuthoringPermission(ctx?.auth?.session);
  const setDefinitionDetail = ctx?.selection?.setDefinitionDetail;
  const selectDefinition = ctx?.selection?.selectDefinition;
  const refreshWorkbench = ctx?.workbench?.refresh;
  const refreshNonce = ctx?.workbench?.refreshNonce;
  const surfaceCode = ctx?.surfaceCode;
  const contractCtx = useMemo(() => ({
    surfaceProps: ctx?.surfaceProps || {},
    selection: {
      definition: ctx?.selection?.definition || {},
    },
    auth: {
      session: ctx?.auth?.session || {},
    },
  }), [ctx?.auth?.session, ctx?.selection?.definition, ctx?.surfaceProps]);
  const defaultModule = normalizeOptionalText(
    ctx?.surfaceProps?.default_module_filter || ctx?.surfaceProps?.module || "process"
  );

  const [payload, setPayload] = useState(null);
  const [taxonomy, setTaxonomy] = useState({});
  const [draft, setDraft] = useState(buildEmptyDraft(defaultModule));
  const [loading, setLoading] = useState(false);
  const [loadingTaxonomy, setLoadingTaxonomy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [validation, setValidation] = useState(null);

  const selectedLabel = useMemo(() => {
    if (!selectedId) return "New Draft";
    return selected?.code || selectedId;
  }, [selected?.code, selectedId]);

  const hydrateFromPayload = useCallback((nextPayload) => {
    const item = nextPayload?.item || null;
    if (!item) {
      setDraft(buildEmptyDraft(defaultModule));
      return;
    }
    setDraft(draftFromItem(item, defaultModule));
  }, [defaultModule]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setPayload(null);
      setError(null);
      setValidation(null);
      setStatus(null);
      setDraft(buildEmptyDraft(defaultModule));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const resolved = resolveContract(detailContract, contractCtx, { pathParams: { id: selectedId } });
      if (!resolved) {
        setPayload(null);
        setDraft(buildEmptyDraft(defaultModule));
        setError("Definition detail contract could not be resolved.");
        return;
      }

      const nextPayload = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      setPayload(nextPayload);
      hydrateFromPayload(nextPayload);
      setDefinitionDetail?.(nextPayload);
    } catch (err) {
      setPayload(null);
      setDraft(buildEmptyDraft(defaultModule));
      setError(describeApiError(err, "Failed to load definition details."));
      setDefinitionDetail?.(null);
    } finally {
      setLoading(false);
    }
  }, [contractCtx, defaultModule, detailContract, hydrateFromPayload, selectedId, setDefinitionDetail]);

  const loadTaxonomy = useCallback(async () => {
    if (!taxonomyContract) return;
    setLoadingTaxonomy(true);
    try {
      const resolved = resolveContract(taxonomyContract, contractCtx);
      if (!resolved) {
        setTaxonomy({});
        return;
      }
      const next = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      setTaxonomy(next?.lists && typeof next.lists === "object" ? next.lists : {});
    } catch {
      setTaxonomy({});
    } finally {
      setLoadingTaxonomy(false);
    }
  }, [contractCtx, taxonomyContract]);

  useEffect(() => {
    loadTaxonomy();
  }, [loadTaxonomy, surfaceCode, refreshNonce]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail, selectedId, refreshNonce]);

  const setField = useCallback((field, value) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  const resetForNew = useCallback(() => {
    setPayload(null);
    setValidation(null);
    setStatus(null);
    setError(null);
    setDraft(buildEmptyDraft(defaultModule));
    selectDefinition?.(null);
    setDefinitionDetail?.(null);
  }, [defaultModule, selectDefinition, setDefinitionDetail]);

  const buildSavePayload = useCallback(() => {
    const attrsParsed = parseJsonText(draft.attrs_text, "Attrs");
    if (!attrsParsed.ok) return attrsParsed;

    const nodesParsed = parseGraphSection(draft.graph_nodes_text, "Graph nodes", []);
    if (!nodesParsed.ok) return nodesParsed;

    const transitionsParsed = parseGraphSection(
      draft.graph_transitions_text,
      "Graph transitions",
      []
    );
    if (!transitionsParsed.ok) return transitionsParsed;

    const macrosParsed = parseGraphSection(draft.graph_macros_text, "Graph macros", {});
    if (!macrosParsed.ok) return macrosParsed;

    const attrs = attrsParsed.value && typeof attrsParsed.value === "object"
      ? { ...attrsParsed.value }
      : {};
    if (draft.module) attrs.module = draft.module;
    if (draft.object_type) attrs.object_type = draft.object_type;
    if (draft.service_object_category) {
      attrs.service_object_category = draft.service_object_category;
    }
    attrs.is_published = draft.is_published === true;

    const graph = {
      object_type: normalizeOptionalText(draft.object_type) || undefined,
      initial_node: normalizeOptionalText(draft.graph_initial_node) || undefined,
      nodes: nodesParsed.value,
      transitions: transitionsParsed.value,
      macros: macrosParsed.value,
    };

    return {
      ok: true,
      value: {
        attrs,
        graph,
      },
    };
  }, [draft]);

  const saveDefinition = useCallback(async () => {
    if (!canAuthor) {
      setStatus("Missing write permission for process authoring.");
      return;
    }

    const parsed = buildSavePayload();
    if (!parsed.ok) {
      setStatus(parsed.error);
      return;
    }

    if (!draft.id && (!normalizeOptionalText(draft.code) || !normalizeOptionalText(draft.name))) {
      setStatus("Code and Name are required for a new definition.");
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      const contract = draft.id ? saveContract : createContract;
      const resolved = resolveContract(contract, contractCtx, {
        pathParams: { id: draft.id || undefined },
      });
      if (!resolved) {
        setStatus("Save contract could not be resolved.");
        return;
      }

      const body = draft.id
        ? {
            name: draft.name,
            module: draft.module || undefined,
            object_type: draft.object_type || undefined,
            is_active: draft.is_active === true,
            is_published: draft.is_published === true,
            graph: parsed.value.graph,
            attrs: parsed.value.attrs,
          }
        : {
            code: draft.code,
            name: draft.name,
            module: draft.module || undefined,
            version: Number(draft.version) || 1,
            is_active: draft.is_active === true,
            is_published: draft.is_published === true,
            object_type: draft.object_type || undefined,
            graph: parsed.value.graph,
            attrs: parsed.value.attrs,
          };

      const response = await apiFetch(resolved.pathWithQuery, {
        method: resolved.method,
        body,
      });

      const item = response?.item || null;
      if (item?.id) {
        selectDefinition?.(item);
        refreshWorkbench?.();
      }

      setStatus(draft.id ? "Definition saved." : "Definition created.");
      await loadDetail();
    } catch (err) {
      setStatus(describeApiError(err, "Failed to save definition."));
    } finally {
      setSaving(false);
    }
  }, [
    buildSavePayload,
    canAuthor,
    contractCtx,
    createContract,
    draft,
    loadDetail,
    refreshWorkbench,
    saveContract,
    selectDefinition,
  ]);

  const validateDefinition = useCallback(async () => {
    if (!draft.id) {
      setStatus("Save the definition first before validating.");
      return;
    }
    const resolved = resolveContract(validateContract, contractCtx, { pathParams: { id: draft.id } });
    if (!resolved) {
      setStatus("Validate contract could not be resolved.");
      return;
    }

    setValidating(true);
    setStatus(null);
    try {
      const result = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      setValidation(result);
      if (result?.valid) {
        setStatus("Validation passed.");
      } else {
        setStatus("Validation failed. Review returned errors.");
      }
    } catch (err) {
      setStatus(describeApiError(err, "Validation call failed."));
    } finally {
      setValidating(false);
    }
  }, [contractCtx, draft.id, validateContract]);

  const publishDefinition = useCallback(async () => {
    if (!canAuthor) {
      setStatus("Missing write permission for process authoring.");
      return;
    }
    if (!draft.id) {
      setStatus("Save the definition first before publishing.");
      return;
    }
    const resolved = resolveContract(publishContract, contractCtx, { pathParams: { id: draft.id } });
    if (!resolved) {
      setStatus("Publish contract could not be resolved.");
      return;
    }

    setPublishing(true);
    setStatus(null);
    try {
      const result = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      if (result?.item) {
        setDraft((prev) => ({ ...prev, is_published: true }));
      }
      setStatus("Definition published.");
      refreshWorkbench?.();
      await loadDetail();
    } catch (err) {
      setStatus(describeApiError(err, "Publish failed."));
    } finally {
      setPublishing(false);
    }
  }, [canAuthor, contractCtx, draft.id, loadDetail, publishContract, refreshWorkbench]);

  const item = payload?.item || null;
  const graphInspection = item?.graph_inspection || {};
  const validationErrors = Array.isArray(validation?.errors) ? validation.errors : [];
  const nodeTypes = Array.isArray(taxonomy?.PROCESS_NODE_TYPE) ? taxonomy.PROCESS_NODE_TYPE : [];
  const edgeTypes = Array.isArray(taxonomy?.PROCESS_EDGE_TYPE) ? taxonomy.PROCESS_EDGE_TYPE : [];
  const effectTypes = Array.isArray(taxonomy?.PROCESS_EFFECT_TYPE) ? taxonomy.PROCESS_EFFECT_TYPE : [];
  const taskActions = Array.isArray(taxonomy?.TASK_ACTION) ? taxonomy.TASK_ACTION : [];

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{sectionEyebrow}</p>
          <h3>{sectionTitle}</h3>
          <p className="muted">Current: {selectedLabel}</p>
        </div>
        <div className="inline-actions">
          <button type="button" className="ghost-button" onClick={resetForNew} disabled={!canAuthor}>
            New
          </button>
          <button type="button" className="ghost-button" onClick={loadDetail} disabled={loading}>
            Refresh
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={saveDefinition}
            disabled={!canAuthor || saving || loading}
          >
            {saving ? "Saving..." : "Save Draft"}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={validateDefinition}
            disabled={validating || !draft.id}
          >
            {validating ? "Validating..." : "Validate"}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={publishDefinition}
            disabled={!canAuthor || publishing || !draft.id}
          >
            {publishing ? "Publishing..." : "Publish"}
          </button>
        </div>
      </div>

      {!canAuthor ? (
        <StateNotice
          kind="warning"
          title="Read-only mode"
          message="This session lacks PROCESS_DEF_WRITE/CRM_PROCESS_DEF_WRITE."
        />
      ) : null}

      {loading ? <StateNotice title="Loading definition details..." /> : null}
      {error ? <StateNotice kind="error" title="Definition error" message={error} /> : null}
      {status ? <StateNotice title={status} kind={validation?.valid === false ? "warning" : "info"} /> : null}
      {validation?.valid === false && validationErrors.length > 0 ? (
        <StateNotice kind="error" title="Validation errors" message={validationErrors.join(", ")} />
      ) : null}

      <div className="stack">
        <div className="form-grid">
          <label className="form-field">
            <span>Code</span>
            <input
              aria-label="Code"
              value={draft.code}
              onChange={(event) => setField("code", event.target.value)}
              disabled={Boolean(draft.id)}
            />
          </label>
          <label className="form-field">
            <span>Name</span>
            <input
              aria-label="Name"
              value={draft.name}
              onChange={(event) => setField("name", event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Module</span>
            <input
              aria-label="Module"
              value={draft.module}
              onChange={(event) => setField("module", event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Version</span>
            <input
              aria-label="Version"
              type="number"
              value={draft.version}
              onChange={(event) => setField("version", Number(event.target.value || 1))}
              disabled={Boolean(draft.id)}
            />
          </label>
          <label className="form-field">
            <span>Service Object Type</span>
            <input
              aria-label="Service Object Type"
              value={draft.object_type}
              onChange={(event) => setField("object_type", event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Service Object Category</span>
            <input
              aria-label="Service Object Category"
              value={draft.service_object_category}
              onChange={(event) => setField("service_object_category", event.target.value)}
            />
          </label>
          <label className="form-toggle">
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(event) => setField("is_active", event.target.checked)}
            />
            <span>Active</span>
          </label>
          <label className="form-toggle">
            <input
              type="checkbox"
              checked={draft.is_published}
              onChange={(event) => setField("is_published", event.target.checked)}
            />
            <span>Published Flag</span>
          </label>
        </div>

        <label className="form-field">
          <span>Graph Initial Node</span>
          <input
            aria-label="Graph Initial Node"
            value={draft.graph_initial_node}
            onChange={(event) => setField("graph_initial_node", event.target.value)}
          />
        </label>

        <div className="editor-grid">
          <label className="form-field">
            <span>Graph Nodes (JSON)</span>
            <textarea
              aria-label="Graph Nodes (JSON)"
              rows={8}
              value={draft.graph_nodes_text}
              onChange={(event) => setField("graph_nodes_text", event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Graph Transitions (JSON)</span>
            <textarea
              aria-label="Graph Transitions (JSON)"
              rows={8}
              value={draft.graph_transitions_text}
              onChange={(event) => setField("graph_transitions_text", event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Graph Macros (JSON)</span>
            <textarea
              aria-label="Graph Macros (JSON)"
              rows={8}
              value={draft.graph_macros_text}
              onChange={(event) => setField("graph_macros_text", event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Attrs (JSON)</span>
            <textarea
              aria-label="Attrs (JSON)"
              rows={8}
              value={draft.attrs_text}
              onChange={(event) => setField("attrs_text", event.target.value)}
            />
          </label>
        </div>

        <div className="table-wrap">
          <h4>Governed Taxonomy Hints</h4>
          {loadingTaxonomy ? (
            <StateNotice title="Loading taxonomy..." />
          ) : (
            <table>
              <tbody>
                <tr>
                  <th>Node Types</th>
                  <td>{listEntries(nodeTypes)}</td>
                </tr>
                <tr>
                  <th>Edge Types</th>
                  <td>{listEntries(edgeTypes)}</td>
                </tr>
                <tr>
                  <th>Effect Types</th>
                  <td>{listEntries(effectTypes)}</td>
                </tr>
                <tr>
                  <th>Task Actions</th>
                  <td>{listEntries(taskActions)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {item ? (
          <div className="table-wrap">
            <h4>Current Projection</h4>
            <table>
              <tbody>
                <tr>
                  <th>Task Labels</th>
                  <td>{Array.isArray(graphInspection.task_labels) ? graphInspection.task_labels.join(", ") : "-"}</td>
                </tr>
                <tr>
                  <th>Macros</th>
                  <td>
                    {Array.isArray(graphInspection.macros)
                      ? graphInspection.macros.map((macro) => macro.macro_code).join(", ")
                      : "-"}
                  </td>
                </tr>
                <tr>
                  <th>Effect Refs</th>
                  <td>
                    {Array.isArray(graphInspection.effect_references)
                      ? graphInspection.effect_references
                          .map((effect) => effect.canonical_effect_code)
                          .join(", ")
                      : "-"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default ProcessDefinitionStudio;
