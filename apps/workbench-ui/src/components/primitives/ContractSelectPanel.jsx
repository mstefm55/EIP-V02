import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, describeApiError } from "../../services/apiClient.js";
import { getPath, resolveContract } from "../../engine/contracts.js";
import StateNotice from "./StateNotice.jsx";

function text(value) {
  return String(value ?? "").trim();
}

function itemValue(item, key) {
  const value = getPath(item, key);
  return value === undefined || value === null ? "" : String(value);
}

function ContractSelectPanel({ node, ctx }) {
  const propsKey = JSON.stringify(node?.props || {});
  const props = useMemo(() => node?.props || {}, [propsKey]);
  const selectionTargetName = text(props.selection_target);
  const valueKey = text(props.value_key || "id");
  const labelKey = text(props.label_key || "name");
  const secondaryKey = text(props.secondary_key || "code");
  const itemsPath = text(props.items_path || "items");
  const selected =
    (selectionTargetName && typeof ctx?.selection?.getTarget === "function"
      ? ctx.selection.getTarget(selectionTargetName)
      : ctx?.selection?.targets?.[selectionTargetName]) || null;
  const selectedValue = itemValue(selected, valueKey);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const contractCtx = useMemo(
    () => ({
      surfaceProps: ctx?.surfaceProps || {},
      surfaceMeta: ctx?.surfaceMeta || {},
      availableSurfaces: ctx?.availableSurfaces || [],
      selection: {
        definition: ctx?.selection?.definition || {},
        targets: ctx?.selection?.targets || {},
      },
      auth: { session: ctx?.auth?.session || {} },
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

  const selectItem = useCallback(
    (item) => {
      if (!selectionTargetName || !item || typeof ctx?.selection?.selectTarget !== "function") return;
      ctx.selection.selectTarget(selectionTargetName, item);

      const clearTargets = Array.isArray(props.clear_targets_on_change)
        ? props.clear_targets_on_change
        : [];
      for (const target of clearTargets) {
        const normalized = text(target);
        if (normalized && normalized !== selectionTargetName && typeof ctx?.selection?.clearTarget === "function") {
          ctx.selection.clearTarget(normalized);
        }
      }

      const selectionUpdates = props.select_targets_on_change;
      if (selectionUpdates && typeof selectionUpdates === "object") {
        for (const [target, value] of Object.entries(selectionUpdates)) {
          if (text(target) && value && typeof value === "object") {
            ctx.selection.selectTarget(target, value);
          }
        }
      }
    },
    [ctx?.selection, props.clear_targets_on_change, props.select_targets_on_change, selectionTargetName]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resolved = resolveContract(props.options_contract, contractCtx);
      if (!resolved) {
        setItems([]);
        setError("This selector is not configured yet.");
        return;
      }
      const payload = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      const value = getPath(payload, itemsPath);
      setItems(Array.isArray(value) ? value : []);
    } catch (err) {
      setItems([]);
      setError(describeApiError(err, "Failed to load options."));
    } finally {
      setLoading(false);
    }
  }, [contractCtx, itemsPath, props.options_contract]);

  useEffect(() => {
    load();
  }, [ctx?.surfaceCode, ctx?.auth?.session?.tenant_id, ctx?.workbench?.refreshNonce]);

  useEffect(() => {
    if (loading || error || !items.length || !selectionTargetName) return;

    const selectedStillExists = selectedValue
      ? items.some((item) => itemValue(item, valueKey) === selectedValue)
      : false;
    if (selectedStillExists) return;

    let fallback = null;
    if (props.default_to_authenticated_tenant === true) {
      const sessionTenantId = text(ctx?.auth?.session?.tenant_id);
      fallback = items.find((item) => text(item?.id) === sessionTenantId) || null;
    }
    if (!fallback && props.auto_select_first === true) {
      fallback = items[0] || null;
    }
    if (fallback) selectItem(fallback);
  }, [
    ctx?.auth?.session?.tenant_id,
    error,
    items,
    loading,
    props.auto_select_first,
    props.default_to_authenticated_tenant,
    selectedValue,
    selectionTargetName,
    selectItem,
    valueKey,
  ]);

  return (
    <section className="card contract-select-panel">
      <div className="card-header">
        <div>
          {props.eyebrow ? <p className="eyebrow">{props.eyebrow}</p> : null}
          <h3>{props.title || "Scope"}</h3>
          {props.subtitle ? <p className="muted">{props.subtitle}</p> : null}
        </div>
        {props.refresh_label ? (
          <button type="button" className="ghost-button" onClick={load} disabled={loading}>
            {loading ? "Loading..." : props.refresh_label}
          </button>
        ) : null}
      </div>

      {loading && items.length === 0 ? <StateNotice title={props.loading_title || "Loading options..."} /> : null}
      {error ? <StateNotice kind="error" title={props.error_title || "Scope error"} message={error} /> : null}
      {!loading && !error && items.length === 0 ? (
        <StateNotice title={props.empty_message || "No options available."} />
      ) : null}

      {!error && items.length > 0 ? (
        <label style={{ display: "grid", gap: "0.45rem", maxWidth: "520px" }}>
          <span style={{ fontWeight: 600 }}>{props.field_label || props.title || "Scope"}</span>
          <select
            value={selectedValue}
            onChange={(event) => {
              const next = items.find((item) => itemValue(item, valueKey) === event.target.value);
              if (next) selectItem(next);
            }}
          >
            {!selectedValue ? <option value="">{props.placeholder || "Select..."}</option> : null}
            {items.map((item, index) => {
              const value = itemValue(item, valueKey) || String(index);
              const label = itemValue(item, labelKey) || value;
              const secondary = secondaryKey ? itemValue(item, secondaryKey) : "";
              return (
                <option key={value} value={value}>
                  {secondary && secondary !== label ? `${label} (${secondary})` : label}
                </option>
              );
            })}
          </select>
        </label>
      ) : null}
    </section>
  );
}

export default ContractSelectPanel;
