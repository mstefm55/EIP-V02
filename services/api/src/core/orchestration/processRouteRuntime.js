import { createInstance } from "../core_process_engine.js";
import {
  bindRouteStepInstance,
  coordinateProcessRoute
} from "./processRouteCoordinator.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function requireText(value, code) {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(code);
  return normalized;
}

export async function executeRouteStartAction(client, snapshot, action, options = {}) {
  if (!action || action.type !== "START_PROCESS") {
    throw new Error("ROUTE_START_ACTION_REQUIRED");
  }

  const tenantId = requireText(options.tenantId, "TENANT_ID_REQUIRED");
  const identityId = requireText(options.identityId, "IDENTITY_ID_REQUIRED");
  const serviceObjectId = requireText(action.service_object_id, "SERVICE_OBJECT_ID_REQUIRED");
  const stepCode = requireText(action.step_code, "ROUTE_STEP_CODE_REQUIRED");
  const processDefId = requireText(action.process_def_id, "PROCESS_DEF_ID_REQUIRED");
  const idempotencyKey = requireText(action.idempotency_key, "IDEMPOTENCY_REQUIRED");

  if (options.serviceObjectId && normalizeText(options.serviceObjectId) !== serviceObjectId) {
    throw new Error("ROUTE_SERVICE_OBJECT_MISMATCH");
  }

  const startProcess = options.startProcess || createInstance;
  const result = await startProcess(client, {
    tenantId,
    identityId,
    serviceObjectId,
    processDefId,
    idempotencyKey
  });

  if (!result?.ok) {
    throw new Error(result?.error || "ROUTE_PROCESS_START_FAILED");
  }

  const processInstanceId = requireText(result?.item?.id, "PROCESS_INSTANCE_ID_REQUIRED");
  const nextSnapshot = bindRouteStepInstance(snapshot, stepCode, processInstanceId);

  return {
    snapshot: nextSnapshot,
    action: {
      type: result.reused === true ? "PROCESS_REUSED" : "PROCESS_STARTED",
      service_object_id: serviceObjectId,
      step_code: stepCode,
      process_def_id: processDefId,
      process_instance_id: processInstanceId,
      idempotency_key: idempotencyKey,
      reused: result.reused === true
    }
  };
}

export async function runProcessRouteTick(client, snapshot, options = {}) {
  const serviceObjectId = requireText(options.serviceObjectId, "SERVICE_OBJECT_ID_REQUIRED");
  const coordination = coordinateProcessRoute(snapshot, { serviceObjectId });

  if (coordination.action.type !== "START_PROCESS") {
    return coordination;
  }

  return executeRouteStartAction(client, coordination.snapshot, coordination.action, {
    ...options,
    serviceObjectId
  });
}
