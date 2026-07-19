function SurfaceRoot({ node, children }) {
  const title = node?.props?.title || node?.props?.surface_kind || "Surface";
  const subtitle = node?.props?.subtitle || "";
  return (
    <main className="surface-root">
      <header className="surface-meta">
        <div>
          <p className="eyebrow">Rendered Surface</p>
          <h1>{title}</h1>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
      </header>
      <div className="surface-grid">{children}</div>
    </main>
  );
}

export default SurfaceRoot;
