import {
  addWorkingMinutes,
  nextWorkingInstant
} from "../temporal/calendarResolver.js";

const ALLOWED_POLICY_KEYS = new Set([
  "not_before_at",
  "delay_after_previous_minutes",
  "working_delay_after_previous_minutes",
  "calendar_code"
]);

function normalizeText(value) {
  return String(value || "").trim();
}

function parseInstant(value, code) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(code);
  return date;
}

function parseNonNegativeMinutes(value, code) {
  if (value === null || value === undefined || value === "") return null;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) throw new Error(code);
  return minutes;
}

export function normalizeRouteTemporalPolicy(value, contextCode = "<unknown>") {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`ROUTE_TEMPORAL_POLICY_INVALID:${contextCode}`);
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_POLICY_KEYS.has(key)) {
      throw new Error(`ROUTE_TEMPORAL_POLICY_FIELD_UNSUPPORTED:${key}`);
    }
  }

  const notBefore = parseInstant(value.not_before_at, "ROUTE_NOT_BEFORE_INVALID");
  const elapsedDelay = parseNonNegativeMinutes(
    value.delay_after_previous_minutes,
    "ROUTE_PREVIOUS_DELAY_INVALID"
  );
  const workingDelay = parseNonNegativeMinutes(
    value.working_delay_after_previous_minutes,
    "ROUTE_PREVIOUS_WORKING_DELAY_INVALID"
  );
  if (elapsedDelay !== null && workingDelay !== null) {
    throw new Error("ROUTE_PREVIOUS_DELAY_MODE_CONFLICT");
  }

  const calendarCode = normalizeText(value.calendar_code) || null;
  if (workingDelay !== null && !calendarCode) {
    throw new Error("ROUTE_WORKING_DELAY_CALENDAR_REQUIRED");
  }

  return {
    ...(notBefore ? { not_before_at: notBefore.toISOString() } : {}),
    ...(elapsedDelay !== null ? { delay_after_previous_minutes: elapsedDelay } : {}),
    ...(workingDelay !== null ? { working_delay_after_previous_minutes: workingDelay } : {}),
    ...(calendarCode ? { calendar_code: calendarCode } : {})
  };
}

function routeTemporalPolicy(step) {
  const attrs = step?.attrs;
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return null;
  return normalizeRouteTemporalPolicy(attrs.temporal_v1, step?.step_code || "<unknown>");
}

function resolveCalendarLayers(policy, options = {}) {
  const calendarCode = normalizeText(policy?.calendar_code);
  if (!calendarCode) return { calendarCode: null, layers: null };

  const map = options.calendarLayersByCode;
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new Error(`ROUTE_CALENDAR_NOT_RESOLVED:${calendarCode}`);
  }
  const layers = map[calendarCode];
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new Error(`ROUTE_CALENDAR_NOT_RESOLVED:${calendarCode}`);
  }
  return { calendarCode, layers };
}

function previousCompletedStep(snapshot, step) {
  const steps = Array.isArray(snapshot?.steps) ? snapshot.steps : [];
  const index = steps.findIndex((candidate) => candidate?.step_code === step?.step_code);
  if (index < 0) throw new Error(`ROUTE_STEP_NOT_FOUND:${step?.step_code || "<unknown>"}`);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (steps[cursor]?.state === "COMPLETED") return steps[cursor];
  }
  return null;
}

function laterConstraint(current, candidate, reason) {
  if (!candidate) return current;
  if (!current || candidate.getTime() > current.at.getTime()) {
    return { at: candidate, reason };
  }
  return current;
}

export function resolveRouteStepTemporalEligibility(snapshot, step, options = {}) {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw new Error("ROUTE_STEP_REQUIRED");
  }
  if (step.state !== "PENDING") {
    throw new Error(`ROUTE_TEMPORAL_STEP_STATE_INVALID:${step.step_code || "<unknown>"}:${step.state}`);
  }

  const now = parseInstant(options.now ?? new Date(), "ROUTE_TEMPORAL_NOW_INVALID");
  const policy = routeTemporalPolicy(step);
  if (!policy) {
    return {
      eligible: true,
      evaluated_at: now.toISOString(),
      eligible_at: now.toISOString(),
      reason: "NO_TEMPORAL_POLICY",
      calendar_code: null
    };
  }

  const notBefore = parseInstant(policy.not_before_at, "ROUTE_NOT_BEFORE_INVALID");
  const elapsedDelay = parseNonNegativeMinutes(
    policy.delay_after_previous_minutes,
    "ROUTE_PREVIOUS_DELAY_INVALID"
  );
  const workingDelay = parseNonNegativeMinutes(
    policy.working_delay_after_previous_minutes,
    "ROUTE_PREVIOUS_WORKING_DELAY_INVALID"
  );

  const { calendarCode, layers } = resolveCalendarLayers(policy, options);

  let constraint = null;
  constraint = laterConstraint(constraint, notBefore, "NOT_BEFORE");

  if (elapsedDelay !== null || workingDelay !== null) {
    const previous = previousCompletedStep(snapshot, step);
    if (!previous) throw new Error(`ROUTE_PREVIOUS_COMPLETED_STEP_REQUIRED:${step.step_code}`);
    const completedAt = parseInstant(
      previous.completed_at,
      `ROUTE_PREVIOUS_COMPLETION_TIME_REQUIRED:${previous.step_code}`
    );
    const delayedAt = elapsedDelay !== null
      ? new Date(completedAt.getTime() + elapsedDelay * 60000)
      : addWorkingMinutes(layers, completedAt, workingDelay, {
          maxDays: options.maxCalendarSearchDays
        });
    constraint = laterConstraint(
      constraint,
      delayedAt,
      elapsedDelay !== null ? "PREVIOUS_DELAY" : "PREVIOUS_WORKING_DELAY"
    );
  }

  let eligibleAt = constraint?.at || now;
  let reason = constraint?.reason || "TEMPORAL_POLICY_ELIGIBLE";

  if (calendarCode) {
    const anchor = new Date(Math.max(now.getTime(), eligibleAt.getTime()));
    const workingAt = nextWorkingInstant(layers, anchor, {
      maxDays: options.maxCalendarSearchDays
    });
    if (workingAt.getTime() > eligibleAt.getTime()) {
      eligibleAt = workingAt;
      reason = workingAt.getTime() > now.getTime() ? "CALENDAR_CLOSED" : reason;
    }
  }

  const eligible = eligibleAt.getTime() <= now.getTime();
  return {
    eligible,
    evaluated_at: now.toISOString(),
    eligible_at: eligibleAt.toISOString(),
    reason: eligible ? "ELIGIBLE" : reason,
    calendar_code: calendarCode
  };
}
