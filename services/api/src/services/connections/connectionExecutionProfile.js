import { getConnectionProfile } from "./connectionProfile.js";
import {
  ConnectionOutboundRuntimeError,
  buildConnectionRequestPlan,
  executeConnectionRequest,
  publicRequestPlan,
} from "./connectionOutboundRuntime.js";

const SENSITIVE_EXECUTION_RESPONSE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "proxy-authenticate",
  "set-cookie",
  "cookie",
]);

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

function sanitizeExecutionResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const headers = {};
  for (const [key, value] of Object.entries(plainObject(result.headers))) {
    if (SENSITIVE_EXECUTION_RESPONSE_HEADERS.has(String(key).toLowerCase())) continue;
    headers[key] = value;
  }
  return { ...result, headers };
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
    throw new ConnectionOutboundRuntimeError(
      "Connection profile was not found.",
      "CONNECTION_NOT_FOUND",
      404
    );
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
  const result = await executeConnectionRequest({
    pool,
    tenantId,
    connectionCode,
    request,
    config,
    requireEnabled,
    services: lowerLevelServices,
  });
  return sanitizeExecutionResult(result);
}

export {
  SENSITIVE_EXECUTION_RESPONSE_HEADERS,
  effectiveConnectionRuntimeProfile,
  executeGovernedConnectionRequest,
  loadEffectiveConnectionRuntimeProfile,
  planGovernedConnectionRequest,
  sanitizeExecutionResult,
};
