import { getConnectionProfile } from "./connectionProfile.js";
import {
  buildConnectionRequestPlan,
  executeConnectionRequest,
  publicRequestPlan,
} from "./connectionOutboundRuntime.js";

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function effectiveConnectionRuntimeProfile(profile) {
  const source = plainObject(profile);
  const attrs = plainObject(source.attrs);
  const outbound = plainObject(source.outbound);
  const outboundAuth = plainObject(outbound.auth);
  const verification = plainObject(source.verification);

  return {
    ...source,
    outbound: {
      ...outbound,
      request: {
        ...plainObject(outbound.request),
        ...plainObject(attrs.outbound_request),
      },
      auth: {
        ...outboundAuth,
        ...plainObject(attrs.oauth_client_credentials),
      },
    },
    verification: {
      ...verification,
      provider_signature: {
        ...plainObject(verification.provider_signature),
        ...plainObject(attrs.provider_signature),
      },
    },
  };
}

async function loadEffectiveConnectionRuntimeProfile(pool, tenantId, connectionCode, services = {}) {
  const loadProfile = services.getConnectionProfile || getConnectionProfile;
  const profile = await loadProfile(pool, tenantId, connectionCode);
  return profile ? effectiveConnectionRuntimeProfile(profile) : null;
}

async function planGovernedConnectionRequest({
  pool,
  tenantId,
  connectionCode,
  request = {},
  services = {},
}) {
  const profile = await loadEffectiveConnectionRuntimeProfile(
    pool,
    tenantId,
    connectionCode,
    services
  );
  if (!profile || profile.setting_status === "deprecated") {
    const error = new Error("Connection profile was not found.");
    error.name = "ConnectionOutboundRuntimeError";
    error.code = "CONNECTION_NOT_FOUND";
    error.status = 404;
    throw error;
  }
  const plan = buildConnectionRequestPlan(profile, request);
  return {
    connection_code: profile?.identity?.connection_code || connectionCode,
    enabled: profile?.identity?.is_enabled === true,
    plan: publicRequestPlan(profile, plan),
  };
}

async function executeGovernedConnectionRequest({
  pool,
  tenantId,
  connectionCode,
  request = {},
  config = {},
  requireEnabled = true,
  services = {},
}) {
  const profile = await loadEffectiveConnectionRuntimeProfile(
    pool,
    tenantId,
    connectionCode,
    services
  );
  const lowerLevelServices = {
    ...services,
    getConnectionProfile: async () => profile,
  };
  return executeConnectionRequest({
    pool,
    tenantId,
    connectionCode,
    request,
    config,
    requireEnabled,
    services: lowerLevelServices,
  });
}

export {
  effectiveConnectionRuntimeProfile,
  executeGovernedConnectionRequest,
  loadEffectiveConnectionRuntimeProfile,
  planGovernedConnectionRequest,
};
