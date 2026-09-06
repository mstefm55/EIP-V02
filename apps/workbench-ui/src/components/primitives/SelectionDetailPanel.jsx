import { getPath } from "../../engine/contracts.js";
import { normalizeSelectionTarget } from "../../engine/selectionModel.js";
import StateNotice from "./StateNotice.jsx";

function normalizeField(rawField) {
  if (typeof rawField === "string") {
    const path = rawField.trim();
    return path ? { path, label: path, format: "auto" } : null;
  }
  if (!rawField || typeof rawField !== "object" || Array.isArray(rawField)) return null;
  const path = String(rawField.path || rawField.key || "").trim();
  if (!path) return null;
  return {
    path,
    label: String(rawField.label || rawField.key || path).trim() || path,
    format: String(rawField.format || "auto").trim().toLowerCase() || "auto",
  };
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatValue(value, format) {
  if (value === undefined || value === null || value === "") return "-";
  if (format === "datetime") return formatDate(value);
  if (format === "bool") return value ? "Yes" : "No";
  if (format === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? String(parsed) : "-";
  }
  if (format === "array_csv") return Array.isArray(value) ? value.join(", ") : "-";
  if (format === "json") {
    try {
      return typeof value === "string" ? value : JSON.stringify(value);
    } catch {
      return "-";
    }
  }
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "-";
    }
  }
  return String(value);
}

function resolveSelected(ctx, target) {
  if (typeof ctx?.selection?.getTarget === "function") {
    return ctx.selection.getTarget(target);
  }
  if (ctx?.selection?.targets && typeof ctx.selection.targets === "object") {
    return ctx.selection.targets[target] || null;
  }
  if (target === "definition") return ctx?.selection?.definition || null;
  return null;
}

function SelectionDetailPanel({ node, ctx }) {
  const props = node?.props || {};
  const target = normalizeSelectionTarget(props.selection_target || props.selection?.target || "definition");
  const title = String(props.title || "Selection Details").trim() || "Selection Details";
  const eyebrow = String(props.eyebrow || "Selected Record").trim() || "Selected Record";
  const emptyMessage =
    String(props.empty_message || "Select a row to inspect its current values.").trim() ||
    "Select a row to inspect its current values.";
  const fields = (Array.isArray(props.fields) ? props.fields : [])
    .map((field) => normalizeField(field))
    .filter(Boolean)
    .slice(0, 48);
  const selected = target ? resolveSelected(ctx, target) : null;

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
      </div>

      {!target ? (
        <StateNotice kind="error" title="Invalid selection target" />
      ) : !selected ? (
        <StateNotice title={emptyMessage} />
      ) : fields.length === 0 ? (
        <StateNotice title="No detail fields are configured for this panel." />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "0.55rem",
          }}
        >
          {fields.map((field) => {
            const value = getPath(selected, field.path);
            return (
              <div
                key={field.path}
                style={{
                  border: "1px solid var(--oa-line-soft)",
                  borderRadius: "10px",
                  background: "var(--oa-bg-surface)",
                  padding: "0.6rem 0.7rem",
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    color: "var(--oa-text-muted)",
                    fontSize: "0.64rem",
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    marginBottom: "0.25rem",
                  }}
                >
                  {field.label}
                </div>
                <div
                  style={{
                    color: "var(--oa-text-primary)",
                    fontSize: "0.78rem",
                    overflowWrap: "anywhere",
                  }}
                >
                  {formatValue(value, field.format)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default SelectionDetailPanel;
