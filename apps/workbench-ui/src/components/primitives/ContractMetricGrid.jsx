import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, describeApiError } from "../../services/apiClient.js";
import { getPath, resolveContract } from "../../engine/contracts.js";
import StateNotice from "./StateNotice.jsx";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeMetric(metric) {
  if (!metric || typeof metric !== "object") return null;
  const key = normalizeText(metric.key);
  if (!key) return null;
  return {
    key,
    label: normalizeText(metric.label) || key,
    format: normalizeText(metric.format) || "auto",
    description: normalizeText(metric.description),
  };
}

function formatMetric(value, format) {
  if (value === undefined || value === null || value === "") return "-";
  if (format === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : "-";
  }
  if (format === "percent") {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toLocaleString()}%` : "-";
  }
  if (format === "datetime") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
  }
  if (typeof value === "number") return value.toLocaleString();
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

function ContractMetricGrid({ node, ctx }) {
  const props = node?.props || {};
  const title = normalizeText(props.title) || "Overview";
  const eyebrow = normalizeText(props.eyebrow) || "Summary";
  const subtitle = normalizeText(props.subtitle);
  const dataContract = props.data_contract || props.contract || null;
  const metricsPath = normalizeText(props.metrics_path) || "metrics";
  const metrics = useMemo(
    () => (Array.isArray(props.metrics) ? props.metrics.map(normalizeMetric).filter(Boolean) : []),
    [props.metrics]
  );
  const [payload, setPayload] = useState(null);
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resolved = resolveContract(dataContract, contractCtx);
      if (!resolved) {
        setPayload(null);
        setError("This summary is not configured yet.");
        return;
      }
      const response = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      setPayload(response);
    } catch (err) {
      setPayload(null);
      setError(describeApiError(err, "Unable to load summary."));
    } finally {
      setLoading(false);
    }
  }, [contractCtx, dataContract]);

  useEffect(() => {
    load();
  }, [load, ctx?.surfaceCode, ctx?.workbench?.refreshNonce]);

  const metricValues = getPath(payload, metricsPath) || {};

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
        <button type="button" className="ghost-button" onClick={load} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {loading && !payload ? <StateNotice title="Loading summary..." /> : null}
      {error ? <StateNotice kind="error" title="Summary unavailable" message={error} /> : null}

      {!error && payload ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "0.85rem",
          }}
        >
          {metrics.map((metric) => (
            <article
              key={metric.key}
              style={{
                border: "1px solid var(--oa-line-soft)",
                borderRadius: "16px",
                padding: "1rem",
                background: "var(--oa-bg-card)",
                minHeight: "116px",
                display: "grid",
                alignContent: "space-between",
                gap: "0.55rem",
              }}
            >
              <span className="muted" style={{ fontSize: "0.75rem" }}>{metric.label}</span>
              <strong style={{ fontSize: "1.7rem", lineHeight: 1.1 }}>
                {formatMetric(getPath(metricValues, metric.key), metric.format)}
              </strong>
              {metric.description ? (
                <small className="muted">{metric.description}</small>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default ContractMetricGrid;
