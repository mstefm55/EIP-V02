const FORBIDDEN_TARGETS = new Set(["__proto__", "prototype", "constructor"]);
const TARGET_PATTERN = /^[a-z][a-z0-9_.:-]{0,79}$/;

export function normalizeSelectionTarget(value, fallback = null) {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (!candidate) return fallback;
  if (FORBIDDEN_TARGETS.has(candidate)) return fallback;
  if (!TARGET_PATTERN.test(candidate)) return fallback;
  return candidate;
}

export function createSelectionState() {
  return {
    targets: {},
    details: {},
  };
}

export function readSelectionTarget(state, targetName = "definition") {
  const target = normalizeSelectionTarget(targetName);
  if (!target) return null;
  return state?.targets?.[target] ?? null;
}

export function readSelectionDetail(state, targetName = "definition") {
  const target = normalizeSelectionTarget(targetName);
  if (!target) return null;
  return state?.details?.[target] ?? null;
}

export function setSelectionTarget(state, targetName, value) {
  const target = normalizeSelectionTarget(targetName);
  if (!target) throw new Error("UI_SELECTION_TARGET_INVALID");
  const current = state && typeof state === "object" ? state : createSelectionState();
  return {
    targets: {
      ...(current.targets || {}),
      [target]: value || null,
    },
    details: {
      ...(current.details || {}),
      [target]: null,
    },
  };
}

export function setSelectionDetail(state, targetName, value) {
  const target = normalizeSelectionTarget(targetName);
  if (!target) throw new Error("UI_SELECTION_TARGET_INVALID");
  const current = state && typeof state === "object" ? state : createSelectionState();
  return {
    targets: { ...(current.targets || {}) },
    details: {
      ...(current.details || {}),
      [target]: value || null,
    },
  };
}

export function clearSelectionTarget(state, targetName) {
  const target = normalizeSelectionTarget(targetName);
  if (!target) throw new Error("UI_SELECTION_TARGET_INVALID");
  const current = state && typeof state === "object" ? state : createSelectionState();
  const targets = { ...(current.targets || {}) };
  const details = { ...(current.details || {}) };
  delete targets[target];
  delete details[target];
  return { targets, details };
}

export function clearSelections() {
  return createSelectionState();
}
