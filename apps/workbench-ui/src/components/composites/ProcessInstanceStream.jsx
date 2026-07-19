import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, describeApiError } from "../../services/apiClient.js";
import { resolveContract } from "../../engine/contracts.js";
import StateNotice from "../primitives/StateNotice.jsx";

const EMPTY_ITEMS = [];

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function ProcessInstanceStream({ node, ctx }) {
  const contract = node?.props?.list_contract || null;
  const sectionTitle = node?.props?.title || "Process Instance Stream";
  const sectionEyebrow = node?.props?.eyebrow || "Workbench Contract";
  const rawDetailInstances = ctx?.selection?.detail?.recent_instances;
  const detailInstances = useMemo(
    () => (Array.isArray(rawDetailInstances) ? rawDetailInstances : EMPTY_ITEMS),
    [rawDetailInstances]
  );
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

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (detailInstances.length > 0) {
      setItems(detailInstances);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const resolved = resolveContract(contract, contractCtx);
      if (!resolved) {
        setItems([]);
        setError("Instance-stream contract could not be resolved.");
        return;
      }

      const payload = await apiFetch(resolved.pathWithQuery, { method: resolved.method });
      setItems(Array.isArray(payload?.items) ? payload.items : []);
    } catch (err) {
      setItems([]);
      setError(describeApiError(err, "Failed to load process instances."));
    } finally {
      setLoading(false);
    }
  }, [contract, contractCtx, detailInstances]);

  useEffect(() => {
    load();
  }, [load, detailInstances, refreshNonce]);

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{sectionEyebrow}</p>
          <h3>{sectionTitle}</h3>
        </div>
        <button type="button" className="ghost-button" onClick={load}>
          Refresh
        </button>
      </div>

      {loading ? <StateNotice title="Loading process instances..." /> : null}
      {error ? <StateNotice kind="error" title="Instance error" message={error} /> : null}
      {!loading && !error && items.length === 0 ? (
        <StateNotice title="No process instances found." />
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Instance Id</th>
                <th>Status</th>
                <th>Service Object</th>
                <th>Started</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.status || "-"}</td>
                  <td>{item.service_object_id || "-"}</td>
                  <td>{formatDate(item.started_at)}</td>
                  <td>{formatDate(item.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export default ProcessInstanceStream;
