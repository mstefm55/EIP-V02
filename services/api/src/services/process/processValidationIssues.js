function normalizeError(value) {
  return String(value || "").trim();
}

function inferLocation(code, parts) {
  const first = String(parts[0] || "").trim();
  const second = String(parts[1] || "").trim();

  if (code.startsWith("NODE_") || code === "HUMAN_TASK_MISSING_TEMPLATE") {
    return first ? `node:${first}` : "graph";
  }
  if (code.startsWith("TRANSITION_") || code.startsWith("ACTION_TYPE_")) {
    return first ? `transition:${first}` : "graph";
  }
  if (code.startsWith("ROUTER_") || code.startsWith("JOIN_") || code === "CYCLE_DETECTED") {
    return first ? `node:${first}` : "graph";
  }
  if (code.startsWith("MACRO_")) {
    return first ? `macro:${first}` : "macro";
  }
  if (code.startsWith("EFFECT_")) {
    if (first === "macro" && second) return `macro:${second}`;
    return first ? `effect:${first}` : "effect";
  }
  if (code.startsWith("TASK_TEMPLATE_")) {
    return first ? `node:${first}` : "task-template";
  }
  if (code.startsWith("SERVICE_OBJECT_") || code.startsWith("SO_")) {
    return "service-object";
  }
  if (code.startsWith("DOCUMENT_")) {
    return "document";
  }
  if (code === "INITIAL_NODE_REQUIRED" || code === "INITIAL_NODE_NOT_FOUND" || code === "NODES_REQUIRED") {
    return "graph";
  }
  if (code === "GRAPH_REQUIRED") return "graph";
  return "process";
}

function defaultMessage(code) {
  switch (code) {
    case "GRAPH_REQUIRED":
      return "Process graph is required.";
    case "NODES_REQUIRED":
      return "Add at least one process step.";
    case "INITIAL_NODE_REQUIRED":
      return "Select a starting step.";
    case "INITIAL_NODE_NOT_FOUND":
      return "The selected starting step does not exist.";
    case "TRANSITION_MACRO_REQUIRED":
      return "Select a macro for this transition.";
    case "TRANSITION_MACRO_NOT_FOUND":
      return "The selected macro is not available.";
    case "TRANSITION_EFFECTS_INLINE_FORBIDDEN":
      return "Move transition effects into a macro.";
    case "MACRO_EFFECTS_REQUIRED":
      return "Add at least one effect to this macro.";
    case "HUMAN_TASK_MISSING_TEMPLATE":
      return "Select a task template for this human task.";
    case "TASK_TEMPLATE_MISSING":
      return "The referenced task template is not available.";
    case "CYCLE_DETECTED":
      return "The process contains an unsupported cycle.";
    default:
      return "Process validation failed.";
  }
}

export function projectProcessValidationIssue(error) {
  const raw = normalizeError(error);
  if (!raw) {
    return {
      code: "PROCESS_VALIDATION_ERROR",
      location: "process",
      details: [],
      message: "Process validation failed.",
      raw: "",
    };
  }

  const [codeRaw, ...parts] = raw.split(":");
  const code = String(codeRaw || "PROCESS_VALIDATION_ERROR").trim() || "PROCESS_VALIDATION_ERROR";

  return {
    code,
    location: inferLocation(code, parts),
    details: parts,
    message: defaultMessage(code),
    raw,
  };
}

export function projectProcessValidationIssues(errors = []) {
  return (Array.isArray(errors) ? errors : [])
    .map(projectProcessValidationIssue)
    .filter((issue) => Boolean(issue.raw));
}
