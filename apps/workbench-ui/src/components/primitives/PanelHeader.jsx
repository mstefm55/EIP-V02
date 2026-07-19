function PanelHeader({ node }) {
  const title = node?.props?.title || "Workbench";
  const subtitle = node?.props?.subtitle || "";
  const eyebrow = node?.props?.eyebrow || "Workspace";

  return (
    <section className="card panel-header">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {subtitle ? <p className="muted">{subtitle}</p> : null}
    </section>
  );
}

export default PanelHeader;
