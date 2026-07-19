function FallbackNode({ node }) {
  return (
    <section className="card warning">
      <h3>Unsupported node</h3>
      <p>
        Node type <code>{node?.type || "unknown"}</code> is not registered in the V2 workbench renderer.
      </p>
    </section>
  );
}

export default FallbackNode;
