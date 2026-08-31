const ALLOWED_SCHEDULE_KEYS = new Set([
  "planned_start_at",
  "planned_finish_at",
  "source_code",
  "revision"
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

function assertRouteStepBelongsToSnapshot(snapshot, step) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("ROUTE_SNAPSHOT_REQUIRED");
  }
  const steps = Array.isArray(snapshot.steps) ? snapshot.steps : [];
  const stepCode = normalizeText(step?.step_code);
  if (!stepCode) throw new Error("ROUTE_STEP_CODE_REQUIRED");
  if (!steps.some((candidate) => normalizeText(candidate?.step_code) === stepCode)) {
    throw new Error(`ROUTE_STEP_NOT_FOUND:${stepCode}`);
  }
}

export function normalizeRouteStepSchedule(value, contextCode = "<unknown>") {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`ROUTE_SCHEDULE_INVALID:${contextCode}`);
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_SCHEDULE_KEYS.has(key)) {
      throw new Error(`ROUTE_SCHEDULE_FIELD_UNSUPPORTED:${key}`);
    }
  }

  const plannedStart = parseInstant(
    value.planned_start_at,
    `ROUTE_PLANNED_START_AT_INVALID:${contextCode}`
  );
  if (!plannedStart) {
    throw new Error(`ROUTE_PLANNED_START_AT_REQUIRED:${contextCode}`);
  }

  const plannedFinish = parseInstant(
    value.planned_finish_at,
    `ROUTE_PLANNED_FINISH_AT_INVALID:${contextCode}`
  );
  if (plannedFinish && plannedFinish.getTime() < plannedStart.getTime()) {
    throw new Error(`ROUTE_SCHEDULE_RANGE_INVALID:${contextCode}`);
  }

  const sourceCode = normalizeText(value.source_code) || null;
  const revision = value.revision === undefined || value.revision === null
    ? null
    : normalizeText(value.revision) || null;

  return {
    planned_start_at: plannedStart.toISOString(),
    ...(plannedFinish ? { planned_finish_at: plannedFinish.toISOString() } : {}),
    ...(sourceCode ? { source_code: sourceCode } : {}),
    ...(revision ? { revision } : {})
  };
}

export function readRouteStepSchedule(step) {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw new Error("ROUTE_STEP_REQUIRED");
  }
  const stepCode = normalizeText(step.step_code) || "<unknown>";
  return normalizeRouteStepSchedule(step.schedule_v1, stepCode);
}

export function resolveRouteStepMaturity(snapshot, step, options = {}) {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw new Error("ROUTE_STEP_REQUIRED");
  }
  if (step.state !== "PENDING") {
    throw new Error(`ROUTE_MATURITY_STEP_STATE_INVALID:${step.step_code || "<unknown>"}:${step.state}`);
  }

  assertRouteStepBelongsToSnapshot(snapshot, step);

  const now = parseInstant(options.now ?? new Date(), "ROUTE_MATURITY_NOW_INVALID");
  const schedule = readRouteStepSchedule(step);

  if (!schedule) {
    return {
      mature: false,
      scheduled: false,
      evaluated_at: now.toISOString(),
      planned_start_at: null,
      planned_finish_at: null,
      schedule_source_code: null,
      schedule_revision: null,
      reason: "SCHEDULE_REQUIRED"
    };
  }

  const plannedStart = parseInstant(
    schedule.planned_start_at,
    `ROUTE_PLANNED_START_AT_INVALID:${step.step_code}`
  );
  const plannedFinish = parseInstant(
    schedule.planned_finish_at,
    `ROUTE_PLANNED_FINISH_AT_INVALID:${step.step_code}`
  );

  const mature = plannedStart.getTime() <= now.getTime();

  return {
    mature,
    scheduled: true,
    evaluated_at: now.toISOString(),
    planned_start_at: plannedStart.toISOString(),
    planned_finish_at: plannedFinish?.toISOString() || null,
    schedule_source_code: schedule.source_code || null,
    schedule_revision: schedule.revision || null,
    reason: mature ? "MATURE" : "PLANNED_START"
  };
}

// Transitional compatibility export for callers/tests that used the previous
// temporal-gate name. The semantics are now persisted-schedule maturity only.
export const resolveRouteStepTemporalEligibility = resolveRouteStepMaturity;
