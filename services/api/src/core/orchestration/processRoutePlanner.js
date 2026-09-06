const DEFAULT_MAX_ROUTE_STEPS = 64;
const MAX_ROUTE_STEPS = 256;
const ROUTE_STATES = new Set(["PENDING", "ACTIVE", "BLOCKED", "COMPLETED", "SKIPPED"]);
const ALLOWED_TRANSITIONS = Object.freeze({
  PENDING: new Set(["ACTIVE", "SKIPPED"]),
  ACTIVE: new Set(["BLOCKED", "COMPLETED"]),
  BLOCKED: new Set(["ACTIVE", "SKIPPED"]),
  COMPLETED: new Set(),
  SKIPPED: new Set()
});

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeState(value) {
  const state = normalizeText(value || "PENDING").toUpperCase();
  if (!ROUTE_STATES.has(state)) throw new Error(`ROUTE_STATE_INVALID:${state || "<blank>"}`);
  return state;
}

function boundedMax(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_ROUTE_STEPS;
  return Math.max(1, Math.min(MAX_ROUTE_STEPS, Math.trunc(n)));
}

function normalizeSequence(value, index) {
  if (value === undefined || value === null || value === "") return index * 100;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`ROUTE_SEQUENCE_INVALID:${index}`);
  return n;
}

function normalizeStep(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`ROUTE_STEP_INVALID:${index}`);
  }

  const stepCode = normalizeText(entry.step_code || entry.stepCode || entry.code);
  if (!stepCode) throw new Error(`ROUTE_STEP_CODE_REQUIRED:${index}`);

  const processDefId = normalizeText(entry.process_def_id || entry.processDefId);
  if (!processDefId) throw new Error(`ROUTE_PROCESS_DEF_REQUIRED:${stepCode}`);

  const processCode = normalizeText(entry.process_code || entry.processCode) || null;
  const processVersionRaw = entry.process_version ?? entry.processVersion ?? null;
  const processVersion = processVersionRaw === null ? null : Number(processVersionRaw);
  if (processVersion !== null && (!Number.isFinite(processVersion) || processVersion <= 0)) {
    throw new Error(`ROUTE_PROCESS_VERSION_INVALID:${stepCode}`);
  }

  return {
    step_code: stepCode,
    sequence: normalizeSequence(entry.sequence, index),
    process_def_id: processDefId,
    process_code: processCode,
    process_version: processVersion,
    state: normalizeState(entry.state || "PENDING"),
    required: entry.required !== false,
    attrs: entry.attrs && typeof entry.attrs === "object" && !Array.isArray(entry.attrs) ? entry.attrs : {}
  };
}

export function buildProcessRouteSnapshot(entries, options = {}) {
  if (!Array.isArray(entries)) throw new Error("ROUTE_ENTRIES_ARRAY_REQUIRED");
  const maxSteps = boundedMax(options.maxSteps);
  if (entries.length > maxSteps) throw new Error("ROUTE_STEP_LIMIT_EXCEEDED");

  const enabled = entries.filter((entry) => entry?.enabled !== false && entry?.applicable !== false);
  const steps = enabled.map(normalizeStep);
  const seen = new Set();
  for (const step of steps) {
    if (seen.has(step.step_code)) throw new Error(`ROUTE_STEP_DUPLICATE:${step.step_code}`);
    seen.add(step.step_code);
  }

  steps.sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.step_code.localeCompare(b.step_code);
  });

  return {
    version: 1,
    created_at: options.createdAt || new Date().toISOString(),
    source_code: normalizeText(options.sourceCode) || null,
    source_version: options.sourceVersion ?? null,
    steps
  };
}

export function resolveNextRouteStep(snapshot) {
  const steps = Array.isArray(snapshot?.steps) ? snapshot.steps : [];
  const active = steps.find((step) => step.state === "ACTIVE" || step.state === "BLOCKED");
  if (active) return active;
  return steps.find((step) => step.state === "PENDING") || null;
}

export function transitionRouteStep(snapshot, stepCode, toState) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("ROUTE_SNAPSHOT_REQUIRED");
  }
  const targetCode = normalizeText(stepCode);
  if (!targetCode) throw new Error("ROUTE_STEP_CODE_REQUIRED");
  const nextState = normalizeState(toState);
  const steps = Array.isArray(snapshot.steps) ? snapshot.steps : [];
  const index = steps.findIndex((step) => step.step_code === targetCode);
  if (index < 0) throw new Error(`ROUTE_STEP_NOT_FOUND:${targetCode}`);

  const currentState = normalizeState(steps[index].state);
  if (!ALLOWED_TRANSITIONS[currentState].has(nextState)) {
    throw new Error(`ROUTE_STATE_TRANSITION_INVALID:${currentState}:${nextState}`);
  }

  const updatedSteps = steps.map((step, stepIndex) =>
    stepIndex === index ? { ...step, state: nextState } : { ...step }
  );

  if (nextState === "ACTIVE") {
    const otherActive = updatedSteps.find(
      (step, stepIndex) => stepIndex !== index && step.state === "ACTIVE"
    );
    if (otherActive) throw new Error(`ROUTE_ACTIVE_STEP_CONFLICT:${otherActive.step_code}`);
  }

  return { ...snapshot, steps: updatedSteps };
}

export function isProcessRouteComplete(snapshot) {
  const steps = Array.isArray(snapshot?.steps) ? snapshot.steps : [];
  return steps.every((step) => step.state === "COMPLETED" || step.state === "SKIPPED");
}
