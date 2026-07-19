function normalizeColumns(value, fallback = 2) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, 4));
}

function normalizeToken(value, fallback) {
  const trimmed = String(value || "").trim();
  return trimmed.length ? trimmed : fallback;
}

function SplitLayout({ node, children }) {
  const props = node?.props || {};
  const columns = normalizeColumns(props.columns, 2);
  const minColumnWidth = normalizeToken(props.min_column_width, "320px");
  const gap = normalizeToken(props.gap, "0.8rem");
  const alignItems = normalizeToken(props.align_items, "start");

  return (
    <section className="split-layout-shell">
      <div
        className="split-layout"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(${minColumnWidth}, 1fr))`,
          gap,
          alignItems,
        }}
      >
        {children}
      </div>
    </section>
  );
}

export default SplitLayout;
