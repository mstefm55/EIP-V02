import { createHash } from "crypto";
import {
  isProcessRouteComplete,
  resolveNextRouteStep,
  transitionRouteStep
} from "./processRoutePlanner.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function cloneSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("ROUTE_SNAPSHOT_REQUIRED");
  }
  return {
    ...snapshot,
    steps: Array.isArray(snapshot.steps) ? snapshot.steps.map((step) => ({ ...step })) : []
  };
}

function findStep(snapshot, stepCode) {
  const code = normalizeText(stepCode);
  if (!code) throw new Error("ROUTE_STEP_CODE_REQUIRED");
  const step = (snapshot.steps || []).find((candidate) => candidate?.step_code === code);
  if (!step) throw new Error(`ROUTE_STEP_NOT_FOUND:${code}`);
  return step;
}

function findStepByInstance(snapshot, processInstanceId) {
  const instanceId = normalizeText(processInstanceId);
  if (!instanceId) throw new Error("PROCESS_INSTANCE_ID_REQUIRED");
  return (snapshot.steps || []).find(
    (step) => normalizeText(step?.process_instance_id) === instanceId
  ) || null;
}

export function buildRouteStepIdempotencyKey(snapshot, options = {}) {
  const serviceObjectId = normalizeText(options.serviceObjectId);
  const step = options.step;
  if (!serviceObjectId) throw new Error("SERVICE_OBJECT_ID_REQUIRED");
  if (!step || typeof step !== "object") throw new Error("ROUTE_STEP_REQUIRED");

  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        service_object_id: serviceObjectId,
        route_created_at: snapshot?.created_at || null,
        route_source_code: snapshot?.source_code || null,
        route_source_version: snapshot?.source_version ?? null,
        step_code: step.step_code,
        process_def_id: step.process_def_id,
        process_version: step.process_version ?? null
      })
    )
    .digest("hex");

  return `route:${digest}`;
}

function buildStartAction(snapshot, step, serviceObjectId) {
  return {
    type: "START_PROCESS",
    service_object_id: serviceObjectId,
    step_code: step.step_code,
    process_def_id: step.process_def_id,
    process_code: step.process_code || null,
    process_version: step.process_version ?? null,
    idempotency_key: buildRouteStepIdempotencyKey(snapshot, {
      serviceObjectId,
      step
    })
  };
}

export function coordinateProcessRoute(snapshot, options = {}) {
  const serviceObjectId = normalizeText(options.serviceObjectId);
  if (!serviceObjectId) throw new Error("SERVICE_OBJECT_ID_REQUIRED");

  let nextSnapshot = cloneSnapshot(snapshot);

  if (isProcessRouteComplete(nextSnapshot)) {
    return {
      snapshot: nextSnapshot,
      action: { type: "ROUTE_COMPLETE", service_object_id: serviceObjectId }
    };
  }

  let step = resolveNextRouteStep(nextSnapshot);
  if (!step) {
    throw new Error("ROUTE_NEXT_STEP_NOT_FOUND");
  }

  if (step.state === "BLOCKED") {
    return {
      snapshot: nextSnapshot,
      action: {
        type: "WAIT_BLOCKED",
        service_object_id: serviceObjectId,
        step_code: step.step_code,
        process_instance_id: step.process_instance_id || null
      }
    };
  }

  if (step.state === "PENDING") {
    nextSnapshot = transitionRouteStep(nextSnapshot, step.step_code, "ACTIVE");
    step = findStep(nextSnapshot, step.step_code);
  }

  if (step.state !== "ACTIVE") {
    throw new Error(`ROUTE_STEP_NOT_STARTABLE:${step.step_code}:${step.state}`);
  }

  if (normalizeText(step.process_instance_id)) {
    return {
      snapshot: nextSnapshot,
      action: {
        type: "WAIT_PROCESS",
        service_object_id: serviceObjectId,
        step_code: step.step_code,
        process_instance_id: step.process_instance_id
      }
    };
  }

  return {
    snapshot: nextSnapshot,
    action: buildStartAction(nextSnapshot, step, serviceObjectId)
  };
}

export function bindRouteStepInstance(snapshot, stepCode, processInstanceId) {
  const nextSnapshot = cloneSnapshot(snapshot);
  const step = findStep(nextSnapshot, stepCode);
  const instanceId = normalizeText(processInstanceId);
  if (!instanceId) throw new Error("PROCESS_INSTANCE_ID_REQUIRED");
  if (step.state !== "ACTIVE") {
    throw new Error(`ROUTE_STEP_INSTANCE_BIND_STATE_INVALID:${step.step_code}:${step.state}`);
  }

  const existing = normalizeText(step.process_instance_id);
  if (existing && existing !== instanceId) {
    throw new Error(`ROUTE_STEP_INSTANCE_CONFLICT:${step.step_code}`);
  }

  step.process_instance_id = instanceId;
  return nextSnapshot;
}

export function applyProcessInstanceOutcome(snapshot, input = {}) {
  let nextSnapshot = cloneSnapshot(snapshot);
  const processInstanceId = normalizeText(input.processInstanceId);
  const status = normalizeText(input.status).toLowerCase();
  if (!processInstanceId) throw new Error("PROCESS_INSTANCE_ID_REQUIRED");
  if (!status) throw new Error("PROCESS_INSTANCE_STATUS_REQUIRED");

  const step = findStepByInstance(nextSnapshot, processInstanceId);
  if (!step) throw new Error(`ROUTE_PROCESS_INSTANCE_NOT_BOUND:${processInstanceId}`);

  if (status === "completed") {
    if (step.state === "COMPLETED") return nextSnapshot;
    if (step.state !== "ACTIVE") {
      throw new Error(`ROUTE_PROCESS_OUTCOME_STATE_INVALID:${step.step_code}:${step.state}:completed`);
    }
    return transitionRouteStep(nextSnapshot, step.step_code, "COMPLETED");
  }

  if (status === "blocked") {
    if (step.state === "BLOCKED") return nextSnapshot;
    if (step.state !== "ACTIVE") {
      throw new Error(`ROUTE_PROCESS_OUTCOME_STATE_INVALID:${step.step_code}:${step.state}:blocked`);
    }
    return transitionRouteStep(nextSnapshot, step.step_code, "BLOCKED");
  }

  if (status === "active") {
    if (step.state !== "ACTIVE") {
      throw new Error(`ROUTE_PROCESS_OUTCOME_STATE_INVALID:${step.step_code}:${step.state}:active`);
    }
    return nextSnapshot;
  }

  throw new Error(`PROCESS_INSTANCE_STATUS_UNSUPPORTED:${status}`);
}

export function resumeBlockedRouteStep(snapshot, stepCode) {
  const nextSnapshot = cloneSnapshot(snapshot);
  const step = findStep(nextSnapshot, stepCode);
  if (step.state !== "BLOCKED") {
    throw new Error(`ROUTE_STEP_RESUME_STATE_INVALID:${step.step_code}:${step.state}`);
  }
  return transitionRouteStep(nextSnapshot, step.step_code, "ACTIVE");
}
