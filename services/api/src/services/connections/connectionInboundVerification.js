import {
  ConnectionInboundRuntimeError,
  verifyInboundRequest,
} from "./connectionInboundRuntime.js";
import {
  ConnectionProviderVerificationError,
  verifyProviderSignature,
} from "./connectionProviderVerification.js";
import { effectiveConnectionRuntimeProfile } from "./connectionExecutionProfile.js";

function text(value) {
  return String(value ?? "").trim();
}

async function verifyGovernedInboundRequest(options = {}) {
  const profile = effectiveConnectionRuntimeProfile(options.profile || {});
  const mode = text(profile?.verification?.mode).toLowerCase();
  if (mode !== "provider_signature") {
    return verifyInboundRequest({ ...options, profile });
  }

  try {
    return await verifyProviderSignature({ ...options, profile });
  } catch (error) {
    if (error instanceof ConnectionProviderVerificationError) {
      throw new ConnectionInboundRuntimeError(
        error.message,
        error.code || "CONNECTION_PROVIDER_SIGNATURE_INVALID",
        Number.isInteger(error.status) ? error.status : 401
      );
    }
    throw error;
  }
}

export { verifyGovernedInboundRequest };
