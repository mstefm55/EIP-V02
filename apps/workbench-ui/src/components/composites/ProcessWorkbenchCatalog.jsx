import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, describeApiError } from "../../services/apiClient.js";
import { resolveContract } from "../../engine/contracts.js";
import StateNotice from "../primitives/StateNotice.jsx";
import { hasAuthoringPermission } from "./workbenchAuthoring.js";

function normalizeFieldLabel(field) {
  return String(field || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCellValue(item, field) {
  if (!item) return "-";
  const value = item[field];
  if (value === null || value === undefined || value === "") return "-";
  if (field === "graph_summary" && typeof value === "object") {
    return `nodes ${value.node_count ?? 0} | transitions ${value.transition_count ?? 0} | macros ${value.macro_count ?? 0}`;
  }
  if (field === "workbench_counts" && typeof value === "object") {
    return `templates ${value.task_template_count ?? 0} | bindings ${value.binding_count ?? 0} | active instances ${value.instance_active_count ?? 0}`;
  }
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ProcessWorkbenchCatalog({ node, ctx }) {
  const contract = node?.props?.data_source || null;
  const sectionTitle = node?.props?.title || "Process Catalog";
  const sectionEyebrow = node?.props?.eyebrow || "Workbench Contract";
  const emptyMessage = node?.props?.empty_message || "No process definitions returned for this surface.";
  const fields = Array.isArray(node?.props?.fields) && node.props.fields.length > 0
    ? node.props.fields
    : ["code", "name", "module", "object_type", "service_object_category"];

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [forceNewMode, setForceNewMode] = useState(false);

  const selectedId = ctx?.selection?.definition?.id || null;
  const selectDefinition = ctx?.selection?.selectDefinition;
  const surfaceCode = ctx?.surfaceCode;
  const tenantId = ctx?.auth?.session?.tenant_id;
  const refreshNonce = ctx?.workbench?.refreshNonce;
  const contractCtx = useMemo(() => ({
    surfaceProps: ctx?.surfaceProps || {},
    selection: {
      definition: ctx?.selection?.definition || {},
    },
    auth: {
      session: ctx?.auth?.session || {},
    },
  }), [ctx?.auth?.session, ctx?.selection?.definition, ctx?.surfaceProps]);
  const canAuthor = hasAuthoringPermission(ctx?.auth?.session);
  const selectionKey = node?.props?.selection_key || "id";
  const contractFingerprint = useMemo(() => JSON.stringify(contract || {}), [contract]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resolved = resolveContract(contract, contractCtx);
      if (!resolved) {
        setItems([]);
        setError("Catalog contract could not be resolved for this surface.");
        return;
      }

      const payload = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      const nextItems = Array.isArray(payload?.items) ? payload.items : [];
      setItems(nextItems);

      if (!selectedId && !forceNewMode && nextItems.length > 0) {
        selectDefinition?.(nextItems[0]);
      }
    } catch (err) {
      setItems([]);
      setError(describeApiError(err, "Failed to load workbench catalog."));
    } finally {
      setLoading(false);
    }
  }, [contract, contractCtx, forceNewMode, selectDefinition, selectedId]);

  useEffect(() => {
    load();
  }, [
    load,
    contractFingerprint,
    surfaceCode,
    tenantId,
    refreshNonce,
  ]);

  useEffect(() => {
    if (selectedId) {
      setForceNewMode(false);
    }
  }, [selectedId]);

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{sectionEyebrow}</p>
          <h3>{sectionTitle}</h3>
        </div>
        <div className="inline-actions">
          {canAuthor ? (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setForceNewMode(true);
                selectDefinition?.(null);
              }}
            >
              New Definition
            </button>
          ) : null}
          <button type="button" className="ghost-button" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      {loading ? <StateNotice title="Loading catalog..." /> : null}
      {error ? <StateNotice kind="error" title="Catalog error" message={error} /> : null}

      {!loading && !error && items.length === 0 ? (
        <StateNotice title={emptyMessage} />
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {fields.map((field) => (
                  <th key={field}>{normalizeFieldLabel(field)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const rowId = item?.[selectionKey] || item?.id;
                const active = selectedId && rowId && selectedId === rowId;
                return (
                  <tr
                    key={rowId || item.code}
                    className={active ? "active-row" : ""}
                    onClick={() => {
                      setForceNewMode(false);
                      selectDefinition?.(item);
                    }}
                  >
                    {fields.map((field) => (
                      <td key={`${rowId}-${field}`}>{formatCellValue(item, field)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export default ProcessWorkbenchCatalog;
