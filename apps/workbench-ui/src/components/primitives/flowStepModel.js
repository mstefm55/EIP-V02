const FLOW_STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const FLOW_STEP_STATUS_SET = new Set([
  "pending",
  "current",
  "complete",
  "warning",
  "error",
  "skipped",
  "disabled",
]);

function normalizeText(value) {
  return String(value ?? "").trim();
}

export function normalizeFlowStepStatus(value, fallback = "pending") {
  const normalized = normalizeText(value).toLowerCase();
  if (FLOW_STEP_STATUS_SET.has(normalized)) return normalized;
  const fallbackNormalized = normalizeText(fallback).toLowerCase();
  return FLOW_STEP_STATUS_SET.has(fallbackNormalized) ? fallbackNormalized : "pending";
}

export function normalizeFlowStep(rawStep) {
  if (!rawStep || typeof rawStep !== "object" || Array.isArray(rawStep)) return null;

  const id = normalizeText(rawStep.id);
  if (!FLOW_STEP_ID_PATTERN.test(id)) return null;

  const label = normalizeText(rawStep.label) || id;
  const description = normalizeText(rawStep.description);
  const icon = normalizeText(rawStep.icon);
  const statusToken = normalizeText(rawStep.status_token || rawStep.statusToken);
  const statusLabel = normalizeText(rawStep.status_label || rawStep.statusLabel);
  const help = normalizeText(rawStep.help);

  const disabled = rawStep.disabled === true;
  const status = disabled
    ? "disabled"
    : normalizeFlowStepStatus(rawStep.status, "pending");

  return {
    id,
    label,
    description,
    icon,
    status,
    status_token: statusToken || null,
    status_label: statusLabel || null,
    optional: rawStep.optional === true,
    disabled,
    help: help || null,
  };
}

export function normalizeFlowSteps(rawSteps, options = {}) {
  const maxSteps = Math.max(1, Math.min(64, Number(options.maxSteps) || 24));
  const input = Array.isArray(rawSteps) ? rawSteps.slice(0, maxSteps) : [];
  const seen = new Set();
  const output = [];

  for (const rawStep of input) {
    const step = normalizeFlowStep(rawStep);
    if (!step || seen.has(step.id)) continue;
    seen.add(step.id);
    output.push(step);
  }

  return output;
}

export function resolveInitialFlowStep(steps, requestedId, defaultId) {
  const list = Array.isArray(steps) ? steps : [];
  const requested = normalizeText(requestedId);
  const preferred = normalizeText(defaultId);

  if (requested) {
    const match = list.find((step) => step.id === requested && !step.disabled);
    if (match) return match;
  }

  if (preferred) {
    const match = list.find((step) => step.id === preferred && !step.disabled);
    if (match) return match;
  }

  return list.find((step) => !step.disabled) || null;
}

export function readSelectedFlowStepId(value) {
  if (typeof value === "string") return normalizeText(value);
  if (!value || typeof value !== "object") return "";
  return normalizeText(value.id || value.step_id || value.stepId);
}

export const FLOW_STEP_STATUSES = Object.freeze([...FLOW_STEP_STATUS_SET]);
