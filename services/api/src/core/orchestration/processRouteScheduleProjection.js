import {
  normalizeRouteStepSchedule,
  resolveRouteStepMaturity
} from "./processRouteTemporalGate.js";

const DEFAULT_MAX_SERVICE_OBJECTS = 50;
const HARD_MAX_SERVICE_OBJECTS = 200;
const DEFAULT_MAX_PROJECTED_STEPS = 5000;
const HARD_MAX_PROJECTED_STEPS = 20000;
const ALLOWED_ROUTE_STATES = new Set([
  "PENDING",
  "ACTIVE",
  "BLOCKED",
  "COMPLETED",
  "SKIPPED"
]);

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function nullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function requireRouteSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("ROUTE_SNAPSHOT_REQUIRED");
  }
  if (Number(snapshot.version) !== 1) {
    throw new Error(`ROUTE_SNAPSHOT_VERSION_UNSUPPORTED:${snapshot.version ?? "<missing>"}`);
  }
  if (!Array.isArray(snapshot.steps)) throw new Error("ROUTE_SNAPSHOT_STEPS_REQUIRED");
  if (snapshot.steps.length > 256) throw new Error("ROUTE_SNAPSHOT_STEP_LIMIT_EXCEEDED");
  return snapshot;
}

function stateObservation(snapshot, step, now) {
  const state = normalizeText(step?.state).toUpperCase();
  if (!ALLOWED_ROUTE_STATES.has(state)) {
    throw new Error(`ROUTE_STATE_UNSUPPORTED:${step?.step_code || "<unknown>"}:${state || "<missing>"}`);
  }

  const schedule = step.schedule_v1 === undefined || step.schedule_v1 === null
    ? null
    : normalizeRouteStepSchedule(step.schedule_v1, step.step_code || "<unknown>");

  if (state === "PENDING") {
    const maturity = resolveRouteStepMaturity(snapshot, step, { now });
    return {
      schedule,
      mature: maturity.mature,
      scheduled: maturity.scheduled,
      wait_reason: maturity.reason,
      planned_start_at: maturity.planned_start_at,
      planned_finish_at: maturity.planned_finish_at,
      schedule_source_code: maturity.schedule_source_code,
      schedule_revision: maturity.schedule_revision
    };
  }

  return {
    schedule,
    mature: state === "ACTIVE" || state === "COMPLETED",
    scheduled: schedule !== null,
    wait_reason: state,
    planned_start_at: schedule?.planned_start_at || null,
    planned_finish_at: schedule?.planned_finish_at || null,
    schedule_source_code: schedule?.source_code || null,
    schedule_revision: schedule?.revision || null
  };
}

export function projectServiceObjectRouteSchedule(row, options = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("SERVICE_OBJECT_ROUTE_ROW_REQUIRED");
  }

  const serviceObjectId = normalizeText(row.id || row.service_object_id);
  if (!serviceObjectId) throw new Error("SERVICE_OBJECT_ID_REQUIRED");

  const snapshot = requireRouteSnapshot(row.route_snapshot || row.process_route_v1);
  const nowValue = options.now ?? new Date();
  const now = nowValue instanceof Date ? new Date(nowValue) : new Date(nowValue);
  if (Number.isNaN(now.getTime())) throw new Error("ROUTE_PROJECTION_NOW_INVALID");

  return snapshot.steps.map((step, stepIndex) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`ROUTE_SNAPSHOT_STEP_INVALID:${stepIndex}`);
    }
    const stepCode = normalizeText(step.step_code);
    if (!stepCode) throw new Error(`ROUTE_SNAPSHOT_STEP_CODE_REQUIRED:${stepIndex}`);

    const observation = stateObservation(snapshot, step, now);

    return {
      id: `${serviceObjectId}:${stepCode}`,
      service_object_id: serviceObjectId,
      service_object_code: nullableText(row.code),
      service_object_title: nullableText(row.title),
      object_type: nullableText(row.object_type),
      service_object_status: nullableText(row.status),
      service_object_updated_at: row.updated_at || null,
      route_version: Number(snapshot.version),
      step_index: stepIndex,
      step_code: stepCode,
      sequence: Number.isFinite(Number(step.sequence)) ? Number(step.sequence) : null,
      process_def_id: nullableText(step.process_def_id),
      process_code: nullableText(step.process_code),
      process_version: Number.isFinite(Number(step.process_version))
        ? Number(step.process_version)
        : null,
      route_state: normalizeText(step.state).toUpperCase(),
      process_instance_id: nullableText(step.process_instance_id),
      planned_start_at: observation.planned_start_at,
      planned_finish_at: observation.planned_finish_at,
      actual_completed_at: step.completed_at || null,
      scheduled: observation.scheduled,
      mature: observation.mature,
      wait_reason: observation.wait_reason,
      schedule_source_code: observation.schedule_source_code,
      schedule_revision: observation.schedule_revision
    };
  });
}

export function projectRouteScheduleRows(rows, options = {}) {
  if (!Array.isArray(rows)) throw new Error("ROUTE_PROJECTION_ROWS_ARRAY_REQUIRED");

  const maxServiceObjects = boundedInteger(
    options.maxServiceObjects,
    DEFAULT_MAX_SERVICE_OBJECTS,
    1,
    HARD_MAX_SERVICE_OBJECTS
  );
  if (rows.length > maxServiceObjects) throw new Error("ROUTE_PROJECTION_SERVICE_OBJECT_LIMIT_EXCEEDED");

  const maxProjectedSteps = boundedInteger(
    options.maxProjectedSteps,
    DEFAULT_MAX_PROJECTED_STEPS,
    1,
    HARD_MAX_PROJECTED_STEPS
  );

  const items = [];
  for (const row of rows) {
    const projected = projectServiceObjectRouteSchedule(row, options);
    if (items.length + projected.length > maxProjectedSteps) {
      throw new Error("ROUTE_PROJECTION_STEP_LIMIT_EXCEEDED");
    }
    items.push(...projected);
  }

  return items;
}
