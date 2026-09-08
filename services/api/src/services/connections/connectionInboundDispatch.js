import { createInstance } from "../../core/core_process_engine.js";
import { withTenantTransaction } from "../../db/tenantTransaction.js";
import {
  claimInboundReceiptWithClient,
  writeInboundDispatchEvidenceWithClient,
} from "./connectionInboundReceipt.js";
import { projectInboundServiceObject, normalizeMappingMode } from "./connectionInboundMapping.js";
import { ConnectionInboundRuntimeError } from "./connectionInboundRuntime.js";

function text(value) {
  return String(value ?? "").trim();
}

function processDispatchError(errorCode) {
  const code = text(errorCode).toUpperCase();
  const configurationErrors = new Set([
    "PROCESS_BINDING_NOT_FOUND",
    "PROCESS_DEF_NOT_FOUND",
    "INITIAL_NODE_REQUIRED",
    "OBJECT_TYPE_MISMATCH",
    "SERVICE_OBJECT_TYPE_INVALID",
    "SERVICE_OBJECT_TYPE_REQUIRED",
  ]);
  if (configurationErrors.has(code) || code.endsWith("_STATUS_INVALID")) {
    return new ConnectionInboundRuntimeError(
      "Inbound mapping could not resolve a governed Service Object/Process binding.",
      `CONNECTION_DISPATCH_${code || "CONFIG_INVALID"}`,
      503
    );
  }
  return new ConnectionInboundRuntimeError(
    "Inbound business dispatch failed.",
    "CONNECTION_DISPATCH_FAILED",
    500
  );
}

async function dispatchInboundWithClient({
  client,
  tenantId,
  profile,
  rawBody,
  receipt,
  createProcessInstance = createInstance,
}) {
  const mode = normalizeMappingMode(profile);
  if (mode === "passthrough") {
    return {
      status: "NOT_BOUND",
      service_object_id: null,
      process_instance_id: null,
      process_def_id: null,
      reused: false,
    };
  }
  if (mode !== "mapped") {
    throw new ConnectionInboundRuntimeError(
      "Inbound mapping mode is not executable.",
      "CONNECTION_MAPPING_MODE_UNSUPPORTED",
      503
    );
  }

  const projection = projectInboundServiceObject(profile, rawBody);
  const receiptId = text(receipt?.receipt_id);
  if (!receiptId) {
    throw new ConnectionInboundRuntimeError(
      "Inbound receipt identity is required before business dispatch.",
      "INBOUND_RECEIPT_REQUIRED",
      500
    );
  }

  const result = await createProcessInstance(client, {
    tenantId,
    identityId: null,
    serviceObject: projection.service_object,
    taskType: projection.task_type,
    idempotencyKey: `connection-inbound:${receiptId}`,
  });
  if (!result?.ok) throw processDispatchError(result?.error);

  return {
    status: "PROCESS_STARTED",
    service_object_id: result.service_object?.id || result.item?.service_object_id || null,
    process_instance_id: result.item?.id || null,
    process_def_id: result.item?.process_def_id || null,
    reused: result.reused === true,
  };
}

async function acceptInboundRequest({
  pool,
  tenantId,
  profile,
  request = {},
  verification = {},
  channel,
  correlationId,
  acceptedAt = new Date().toISOString(),
  transaction = withTenantTransaction,
  claimReceipt = claimInboundReceiptWithClient,
  dispatchRequest = dispatchInboundWithClient,
  writeDispatchEvidence = writeInboundDispatchEvidenceWithClient,
}) {
  return transaction(pool, tenantId, async (client) => {
    const receipt = await claimReceipt({
      client,
      tenantId,
      profile,
      request,
      verification,
      channel,
      correlationId,
      acceptedAt,
    });

    if (receipt.duplicate) {
      return {
        duplicate: true,
        receipt,
        dispatch: receipt.dispatch || null,
      };
    }

    const dispatch = await dispatchRequest({
      client,
      tenantId,
      profile,
      rawBody: request.rawBody,
      receipt,
    });

    const evidence = await writeDispatchEvidence({
      client,
      tenantId,
      receiptId: receipt.receipt_id,
      dispatch,
    });

    return {
      duplicate: false,
      receipt: { ...receipt, dispatch: evidence },
      dispatch: evidence,
    };
  });
}

export {
  acceptInboundRequest,
  dispatchInboundWithClient,
  processDispatchError,
};
