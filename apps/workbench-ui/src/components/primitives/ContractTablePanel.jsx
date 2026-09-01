import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, describeApiError } from "../../services/apiClient.js";
import { getPath, resolveContract } from "../../engine/contracts.js";
import { normalizeSelectionTarget } from "../../engine/selectionModel.js";
import StateNotice from "./StateNotice.jsx";

function normalizeColumn(column) {
  if (typeof column === "string") {
    return { key: column, label: column, format: "auto" };
  }
  if (!column || typeof column !== "object") {
    return null;
  }
  const key = String(column.key || "").trim();
  if (!key) return null;
  return {
    key,
    label: String(column.label || key).trim() || key,
    format: String(column.format || "auto").trim() || "auto",
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function toBusinessEyebrow(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  const normalized = text.toLowerCase();
  if (normalized.includes("ui engine")) return "Business Records";
  if (normalized.includes("workbench contract")) return "Business Records";
  return text;
}

function humanizeLabel(value) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeColumns(columns) {
  const source = Array.isArray(columns) ? columns : [];
  const normalized = source.map((column) => normalizeColumn(column)).filter(Boolean);
  return normalized.map((column) => ({
    ...column,
    label: column.label === column.key ? humanizeLabel(column.label) : column.label,
  }));
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatSummary(value, fallback = "-") {
  if (!value || typeof value !== "object") return fallback;
  return `nodes ${value.node_count ?? 0} | transitions ${value.transition_count ?? 0} | macros ${value.macro_count ?? 0}`;
}

function formatWorkbenchCounts(value, fallback = "-") {
  if (!value || typeof value !== "object") return fallback;
  return `templates ${value.task_template_count ?? 0} | bindings ${value.binding_count ?? 0} | active instances ${value.instance_active_count ?? 0}`;
}

function formatValue(item, column) {
  const value = item?.[column.key];
  if (value === undefined || value === null || value === "") return "-";

  if (column.format === "datetime") return formatDate(value);
  if (column.format === "graph_summary") return formatSummary(value);
  if (column.format === "workbench_counts") return formatWorkbenchCounts(value);
  if (column.format === "json") {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return "-";
    }
  }
  if (column.format === "bool") return value ? "true" : "false";
  if (column.format === "array_csv") return Array.isArray(value) ? value.join(", ") : "-";
  if (column.format === "text") return String(value);

  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function resolveCardText(item, key, fallback = "-") {
  const value = getPath(item, key);
  const normalized = normalizeText(value);
  return normalized || fallback;
}

function resolveSelectionTarget(ctx, targetName) {
  const target = normalizeSelectionTarget(targetName || "definition");
  if (!target) {
    return { selected: null, select: null, clear: null };
  }

  if (typeof ctx?.selection?.selectTarget === "function") {
    const selected =
      (typeof ctx?.selection?.getTarget === "function" && ctx.selection.getTarget(target)) ||
      ctx?.selection?.targets?.[target] ||
      null;
    return {
      selected,
      select: (value) => ctx.selection.selectTarget(target, value),
      clear:
        typeof ctx?.selection?.clearTarget === "function"
          ? () => ctx.selection.clearTarget(target)
          : null,
    };
  }

  if (target === "definition") {
    return {
      selected: ctx?.selection?.definition || null,
      select: ctx?.selection?.selectDefinition || null,
      clear: ctx?.selection?.clear || null,
    };
  }

  return {
    selected: null,
    select: null,
    clear: null,
  };
}

function hasAnyPermission(session, expected = []) {
  if (!Array.isArray(expected) || expected.length === 0) return true;
  const granted = Array.isArray(session?.permissions) ? session.permissions : [];
  return expected.some((permission) => granted.includes(permission));
}

function normalizePageSizeOptions(rawValue) {
  const source = Array.isArray(rawValue) ? rawValue : [10, 25, 50];
  const normalized = source
    .map((value) => Number.parseInt(String(value ?? ""), 10))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 500);
  const deduped = Array.from(new Set(normalized));
  return deduped.length > 0 ? deduped : [10, 25, 50];
}

function normalizePageSize(rawValue, fallback) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 500) return parsed;
  return fallback;
}

function ContractTablePanel({ node, ctx }) {
  const propsKey = JSON.stringify(node?.props || {});
  const props = useMemo(() => node?.props || {}, [propsKey]);
  const listContract = props.list_contract || props.data_source || null;
  const columns = useMemo(
    () => normalizeColumns(props.columns || props.fields || []),
    [props.columns, props.fields]
  );
  const sectionTitle = props.title || "Records";
  const sectionEyebrow = toBusinessEyebrow(props.eyebrow, "Business Records");
  const loadingTitle = props.loading_title || "Loading table data...";
  const emptyMessage = props.empty_message || "No rows returned.";
  const errorTitle = props.error_title || "Table error";
  const refreshLabel = props.refresh_label || "Refresh";
  const refreshingLabel = props.refreshing_label || "Refreshing...";
  const displayMode = normalizeText(props.display_mode).toLowerCase();
  const libraryMode = displayMode === "library_cards";
  const libraryView = props.library_view && typeof props.library_view === "object"
    ? props.library_view
    : {};
  const libraryTitleField = normalizeText(libraryView.title_field || "name");
  const libraryCodeField = normalizeText(libraryView.code_field || "code");
  const libraryMetaField = normalizeText(libraryView.meta_field || "module");
  const libraryEmptyMessage = normalizeText(libraryView.empty_message) || emptyMessage;
  const preloadedItemsPath = props.preloaded_items_path || "";
  const rowIdKey = props.row_id_key || props.selection_key || "id";
  const tableMaxHeight = String(props.table_max_height || "420px");
  const selectionConfig = props.selection || null;
  const selectionIdKey = String(selectionConfig?.key || "").trim();
  const selectionTarget = useMemo(
    () => resolveSelectionTarget(ctx, selectionConfig?.target),
    [ctx?.selection, selectionConfig?.target]
  );
  const selectionTargetRef = useRef(selectionTarget);
  useEffect(() => {
    selectionTargetRef.current = selectionTarget;
  }, [selectionTarget]);

  const selectedRowId =
    selectionTarget.selected?.[selectionIdKey] ??
    selectionTarget.selected?.[rowIdKey] ??
    selectionTarget.selected?.id ??
    null;
  const forceNewRef = useRef(false);
  const previousSelectedRowRef = useRef(selectedRowId);
  const selectedRowIdRef = useRef(selectedRowId);
  useEffect(() => {
    selectedRowIdRef.current = selectedRowId;
  }, [selectedRowId]);

  if (previousSelectedRowRef.current && !selectedRowId) {
    forceNewRef.current = true;
  }
  previousSelectedRowRef.current = selectedRowId;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const paginationEnabled = props.pagination?.enabled !== false;
  const pageSizeOptions = useMemo(
    () => normalizePageSizeOptions(props.pagination?.page_size_options),
    [props.pagination?.page_size_options]
  );
  const defaultPageSize = useMemo(
    () => normalizePageSize(props.pagination?.default_page_size, pageSizeOptions[0]),
    [pageSizeOptions, props.pagination?.default_page_size]
  );
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [pageIndex, setPageIndex] = useState(0);

  const contractCtx = useMemo(
    () => ({
      surfaceProps: ctx?.surfaceProps || {},
      surfaceMeta: ctx?.surfaceMeta || {},
      availableSurfaces: ctx?.availableSurfaces || [],
      selection: {
        definition: ctx?.selection?.definition || {},
        targets: ctx?.selection?.targets || {},
      },
      auth: {
        session: ctx?.auth?.session || {},
      },
    }),
    [
      ctx?.auth?.session,
      ctx?.availableSurfaces,
      ctx?.selection?.definition,
      ctx?.selection?.targets,
      ctx?.surfaceMeta,
      ctx?.surfaceProps,
    ]
  );

  const preloadedItems = useMemo(() => {
    if (!preloadedItemsPath) return [];
    const value = getPath(ctx, preloadedItemsPath);
    return Array.isArray(value) ? value : [];
  }, [ctx, preloadedItemsPath]);

  const load = useCallback(async () => {
    if (preloadedItems.length > 0) {
      setItems(preloadedItems);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const resolved = resolveContract(listContract, contractCtx);
      if (!resolved) {
        setItems([]);
        setError("This list is not configured yet.");
        return;
      }

      const payload = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      const nextItems = Array.isArray(payload?.items) ? payload.items : [];
      setItems(nextItems);

      const autoSelect = selectionConfig?.auto_select_first === true;
      if (
        autoSelect &&
        !selectedRowIdRef.current &&
        !forceNewRef.current &&
        nextItems.length > 0 &&
        typeof selectionTargetRef.current?.select === "function"
      ) {
        selectionTargetRef.current.select(nextItems[0]);
      }
    } catch (err) {
      setItems([]);
      setError(describeApiError(err, "Failed to load table data."));
    } finally {
      setLoading(false);
    }
  }, [
    contractCtx,
    listContract,
    preloadedItems,
    selectionConfig?.auto_select_first,
  ]);

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    loadRef.current();
  }, [ctx?.surfaceCode, ctx?.auth?.session?.tenant_id, ctx?.workbench?.refreshNonce]);

  useEffect(() => {
    if (selectedRowId) {
      forceNewRef.current = false;
    }
  }, [selectedRowId]);

  useEffect(() => {
    setPageSize(defaultPageSize);
    setPageIndex(0);
  }, [defaultPageSize]);

  useEffect(() => {
    setPageIndex(0);
  }, [items.length, pageSize]);

  const totalRows = items.length;
  const totalPages = paginationEnabled ? Math.max(1, Math.ceil(totalRows / pageSize)) : 1;
  const boundedPageIndex = Math.min(pageIndex, Math.max(0, totalPages - 1));
  const pageStart = paginationEnabled ? boundedPageIndex * pageSize : 0;
  const pageEnd = paginationEnabled ? pageStart + pageSize : totalRows;
  const visibleItems = paginationEnabled ? items.slice(pageStart, pageEnd) : items;
  const rangeStart = totalRows === 0 ? 0 : pageStart + 1;
  const rangeEnd = totalRows === 0 ? 0 : Math.min(totalRows, pageEnd);
  const showLoadingNotice = loading && items.length === 0;

  const canRunNewAction = hasAnyPermission(
    ctx?.auth?.session,
    selectionConfig?.new_action?.requires_any_permission || []
  );

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{sectionEyebrow}</p>
          <h3>{sectionTitle}</h3>
        </div>
        <div className="inline-actions">
          {selectionConfig?.new_action?.label && canRunNewAction ? (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                forceNewRef.current = true;
                if (selectionConfig?.clear_on_new && typeof selectionTarget.select === "function") {
                  selectionTarget.select(null);
                  return;
                }
                if (typeof selectionTarget.clear === "function") {
                  selectionTarget.clear();
                }
              }}
            >
              {selectionConfig.new_action.label}
            </button>
          ) : null}
          <button type="button" className="ghost-button" onClick={load} disabled={loading}>
            {loading ? refreshingLabel : refreshLabel}
          </button>
        </div>
      </div>

      {showLoadingNotice ? <StateNotice title={loadingTitle} /> : null}
      {error ? <StateNotice kind="error" title={errorTitle} message={error} /> : null}
      {!loading && !error && items.length === 0 ? (
        <StateNotice title={libraryMode ? libraryEmptyMessage : emptyMessage} />
      ) : null}

      {!loading && !error && items.length > 0 && libraryMode ? (
        <div className="library-card-list">
          {items.map((item, rowIndex) => {
            const rowId = item?.[rowIdKey] || item?.id || `${rowIndex}`;
            const active = selectedRowId && rowId && rowId === selectedRowId;
            const clickable = typeof selectionTarget.select === "function";
            const code = resolveCardText(item, libraryCodeField, "PROCESS");
            const title = resolveCardText(item, libraryTitleField, code);
            const meta = resolveCardText(item, libraryMetaField, "");
            return (
              <button
                key={`library-${rowId}`}
                type="button"
                className={active ? "library-card active" : "library-card"}
                onClick={
                  clickable
                    ? () => {
                        forceNewRef.current = false;
                        selectionTarget.select(item);
                      }
                    : undefined
                }
              >
                <p className="library-card-code">{code}</p>
                <strong>{title}</strong>
                {meta ? <small>{meta}</small> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {!loading && !error && items.length > 0 && !libraryMode ? (
        <div className="table-wrap" style={{ maxHeight: tableMaxHeight }}>
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item, rowIndex) => {
                const rowId = item?.[rowIdKey] || item?.id || `${rowIndex}`;
                const active = selectedRowId && rowId && rowId === selectedRowId;
                const clickable = typeof selectionTarget.select === "function";
                return (
                  <tr
                    key={rowId}
                    className={active ? "active-row" : ""}
                    onClick={
                      clickable
                        ? () => {
                            forceNewRef.current = false;
                            selectionTarget.select(item);
                          }
                        : undefined
                    }
                  >
                    {columns.map((column) => (
                      <td key={`${rowId}-${column.key}`}>{formatValue(item, column)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && !error && paginationEnabled && !libraryMode && items.length > 0 ? (
        <div className="table-footer">
          <div className="table-footnote">
            Showing {rangeStart}-{rangeEnd} of {totalRows}
          </div>
          <div className="table-pagination">
            <label>
              Per page
              <select
                value={pageSize}
                onChange={(event) => {
                  const next = normalizePageSize(event.target.value, pageSizeOptions[0]);
                  setPageSize(next);
                }}
              >
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <span>
              Page {boundedPageIndex + 1} / {totalPages}
            </span>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setPageIndex((prev) => Math.max(0, prev - 1))}
              disabled={boundedPageIndex === 0}
            >
              Prev
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() =>
                setPageIndex((prev) => Math.min(totalPages - 1, prev + 1))
              }
              disabled={boundedPageIndex + 1 >= totalPages}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default ContractTablePanel;
