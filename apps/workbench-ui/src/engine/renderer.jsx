import React, { useMemo } from "react";
import { sanitizeSurfacePayload } from "./surfacePayload.js";

const MAX_RENDER_DEPTH = 32;

function renderNode(node, registry, ctx, pathKey = "root", depth = 0) {
  if (!node || typeof node !== "object" || depth > MAX_RENDER_DEPTH) return null;
  const nodeType = typeof node.type === "string" ? node.type : "Fallback";
  const Component = registry[nodeType] || registry.Fallback;
  if (!Component) return null;

  const children = Array.isArray(node.children)
    ? node.children.map((child, index) =>
        renderNode(
          child,
          registry,
          ctx,
          `${pathKey}.${child?.id || child?.type || "node"}-${index}`,
          depth + 1
        )
      )
    : null;

  return (
    <Component key={node.id || pathKey} node={node} ctx={ctx}>
      {children}
    </Component>
  );
}

function EngineRenderer({ surface, registry, ctx }) {
  // Keep node/props references stable between unrelated rerenders.
  // Without this memo, components that key effects on node.props can refetch in loops.
  const sanitizedSurface = useMemo(() => sanitizeSurfacePayload(surface), [surface]);
  if (!sanitizedSurface?.tree) return null;
  return renderNode(sanitizedSurface.tree, registry, ctx);
}

export { EngineRenderer };
