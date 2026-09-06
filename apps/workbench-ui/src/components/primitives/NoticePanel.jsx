function normalizeText(value) {
  return String(value ?? "").trim();
}

function NoticePanel({ node }) {
  const props = node?.props || {};
  const eyebrow = normalizeText(props.eyebrow) || "Information";
  const title = normalizeText(props.title) || "Status";
  const message = normalizeText(props.message);
  const items = Array.isArray(props.items)
    ? props.items.map(normalizeText).filter(Boolean)
    : [];

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
          {message ? <p className="muted">{message}</p> : null}
        </div>
      </div>
      {items.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: "1.2rem", display: "grid", gap: "0.5rem" }}>
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
    </section>
  );
}

export default NoticePanel;
