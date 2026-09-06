import {
  applyProcessInstanceOutcome
} from "./processRouteCoordinator.js";
import { runProcessRouteTick } from "./processRouteRuntime.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function requireText(value, code) {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizeProcessStatus(value) {
  return normalizeText(value).toLowerCase();
}

export async function readProcessInstanceOutcome(client, action, options = {}) {
  if (!action || action.type !== "WAIT_PROCESS") {
    throw new Error("ROUTE_WAIT_PROCESS_ACTION_REQUIRED");
  }

  const tenantId = requireText(options.tenantId, "TENANT_ID_REQUIRED");
  const serviceObjectId = requireText(action.service_object_id, "SERVICE_OBJECT_ID_REQUIRED");
  const processInstanceId = requireText(action.process_instance_id, "PROCESS_INSTANCE_ID_REQUIRED");

  if (options.serviceObjectId && normalizeText(options.serviceObjectId) !== serviceObjectId) {
    throw new Error("ROUTE_SERVICE_OBJECT_MISMATCH");
  }

  const result = await client.query(
    `
    SELECT id, service_object_id, process_def_id, status, ended_at
    FROM eip_core.process_instance
    WHERE tenant_id=$1 AND id=$2
    LIMIT 1
    `,
    [tenantId, processInstanceId]
  );

  if (result.rowCount === 0) throw new Error("PROCESS_INSTANCE_NOT_FOUND");
  const row = result.rows[0] || {};

  if (normalizeText(row.service_object_id) !== serviceObjectId) {
    throw new Error("ROUTE_PROCESS_INSTANCE_SERVICE_OBJECT_MISMATCH");
  }

  const status = normalizeProcessStatus(row.status);
  if (!status) throw new Error("PROCESS_INSTANCE_STATUS_REQUIRED");

  if (row.ended_at && status === "active") {
    throw new Error("PROCESS_INSTANCE_STATE_INCONSISTENT");
  }
  if (status === "completed" && !row.ended_at) {
    throw new Error("PROCESS_INSTANCE_STATE_INCONSISTENT");
  }

  if (!["active", "blocked", "completed"].includes(status)) {
    throw new Error(`PROCESS_INSTANCE_STATUS_UNSUPPORTED:${status}`);
  }

  return {
    process_instance_id: processInstanceId,
    service_object_id: serviceObjectId,
    process_def_id: normalizeText(row.process_def_id) || null,
    status,
    ended_at: row.ended_at || null
  };
}

export async function runProcessRouteLifecycleTick(client, snapshot, options = {}) {
  const serviceObjectId = requireText(options.serviceObjectId, "SERVICE_OBJECT_ID_REQUIRED");
  const first = await runProcessRouteTick(client, snapshot, {
    ...options,
    serviceObjectId
  });

  if (first.action.type !== "WAIT_PROCESS") {
    return first;
  }

  const observation = await readProcessInstanceOutcome(client, first.action, {
    ...options,
    serviceObjectId
  });

  if (observation.status === "active") {
    return {
      ...first,
      observation
    };
  }

  const observedSnapshot = applyProcessInstanceOutcome(first.snapshot, {
    processInstanceId: observation.process_instance_id,
    status: observation.status,
    completedAt: observation.status === "completed" ? observation.ended_at : null
  });

  const next = await runProcessRouteTick(client, observedSnapshot, {
    ...options,
    serviceObjectId
  });

  return {
    ...next,
    observation
  };
}
