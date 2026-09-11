import {
  SAFE_CONNECTION_PROBE_METHODS,
  SUPPORTED_IDEMPOTENCY_LOCATIONS,
  SUPPORTED_IDEMPOTENCY_SCOPES,
  SUPPORTED_INBOUND_VERIFICATION_MODES,
  SUPPORTED_MAPPING_MODES,
  SUPPORTED_OUTBOUND_AUTH_MODES,
  SUPPORTED_OUTBOUND_BODY_ENCODINGS,
  SUPPORTED_OUTBOUND_RESPONSE_ENCODINGS,
  buildConnectionActivationStatus,
  outboundRequestDefaults,
  requiredInboundSecretKind,
  requiredOutboundSecretKind,
} from "./connectionActivation.js";
import { validateInboundMappingConfig } from "./connectionInboundMapping.js";
import {
  isSupportedInboundHttpMethod,
  isValidInboundSuffix,
} from "./connectionInboundPolicy.js";
import { inspectInboundRateLimit } from "./connectionRateLimitPolicy.js";

const LIVE_INBOUND_MODES = SUPPORTED_INBOUND_VERIFICATION_MODES;
const LIVE_OUTBOUND_AUTH_MODES = SUPPORTED_OUTBOUND_AUTH_MODES;

function text(value) {
  return String(value ?? "").trim();
}

function secretConfigured(statuses, kind) {
  if (!kind) return true;
  const status = statuses?.[kind];
  return status?.configured === true && status?.status === "active";
}

function buildInboundReadiness(profile, credentialStatuses = {}) {
  const identity = profile?.identity || {};
  const inbound = profile?.inbound || {};
  const verification = profile?.verification || {};
  const idempotency = profile?.idempotency || {};
  const routing = profile?.routing || {};
  const direction = text(identity.direction).toLowerCase();
  const environment = text(identity.environment).toLowerCase();
  const verificationMode = text(verification.mode).toLowerCase();
  const eventLocation = text(idempotency.event_id_location).toLowerCase();
  const idempotencyScope = text(idempotency.idempotency_scope).toLowerCase();
  const mappingMode = text(routing.mapping_mode).toLowerCase();
  const mappingErrors = mappingMode === "mapped"
    ? validateInboundMappingConfig(profile, { requireMapped: true })
    : [];
  const rateLimit = inspectInboundRateLimit(profile);
  const requiredSecretKind = requiredInboundSecretKind(profile);
  const activation = buildConnectionActivationStatus(profile, credentialStatuses);

  const checks = [
    {
      code: "DIRECTION",
      ok: ["inbound", "both"].includes(direction),
      message: "Connection direction permits inbound traffic.",
    },
    {
      code: "INBOUND_ENABLED",
      ok: inbound.webhook_enabled === true,
      message: "Inbound transport is enabled.",
    },
    {
      code: "PATH_SUFFIX",
      ok: isValidInboundSuffix(inbound.inbound_path_suffix),
      message: "Inbound path suffix is configured and valid for the live gateway.",
    },
    {
      code: "HTTP_METHOD",
      ok: isSupportedInboundHttpMethod(inbound.http_method),
      message: "Inbound HTTP method is supported by the live gateway (POST, PUT or PATCH).",
    },
    {
      code: "CONTENT_TYPE",
      ok: Boolean(text(inbound.expected_content_type)),
      message: "Expected content type is configured.",
    },
    {
      code: "VERIFICATION",
      ok:
        Boolean(verificationMode)
        && LIVE_INBOUND_MODES.has(verificationMode)
        && !(environment === "production" && verificationMode === "none"),
      message: "Inbound verification uses an implemented connection verification mode.",
    },
    {
      code: "UNVERIFIED_POLICY",
      ok:
        verificationMode !== "none"
        || (environment !== "production" && verification.allow_unverified === true),
      message: verificationMode === "none"
        ? "Sandbox unverified traffic is explicitly enabled."
        : "Inbound traffic uses a verification policy.",
    },
    {
      code: "CREDENTIAL",
      ok: secretConfigured(credentialStatuses, requiredSecretKind),
      message: requiredSecretKind
        ? `Required ${requiredSecretKind} credential is configured.`
        : "Verification mode does not require a stored symmetric connection credential.",
    },
    {
      code: "IDEMPOTENCY_LOCATION",
      ok: SUPPORTED_IDEMPOTENCY_LOCATIONS.has(eventLocation),
      message: "Inbound event ID location is configured.",
    },
    {
      code: "IDEMPOTENCY_KEY",
      ok: Boolean(text(idempotency.event_id_key)),
      message: "Inbound event ID key/path is configured.",
    },
    {
      code: "IDEMPOTENCY_SCOPE",
      ok: SUPPORTED_IDEMPOTENCY_SCOPES.has(idempotencyScope),
      message: "Inbound idempotency scope is configured.",
    },
    {
      code: "RATE_LIMIT",
      ok: rateLimit.valid,
      message: rateLimit.configured
        ? "Inbound rate-limit max and window form a valid bounded pair."
        : "Inbound rate limiting is optional and currently not configured.",
    },
    {
      code: "MAPPING_MODE",
      ok: SUPPORTED_MAPPING_MODES.has(mappingMode),
      message: "Inbound mapping mode is configured.",
    },
    {
      code: "MAPPING_CONFIGURATION",
      ok: mappingMode !== "mapped" || mappingErrors.length === 0,
      message: mappingMode === "mapped"
        ? "Mapped dispatch has a bounded Service Object projection."
        : "Passthrough mode is transport-only and does not start business processing.",
    },
  ];

  const configured = checks.every((check) => check.ok);
  const liveMode = LIVE_INBOUND_MODES.has(verificationMode);
  const runtimeAvailable = configured && liveMode && activation.ready;
  const runtimeStatus = runtimeAvailable
    ? "AVAILABLE"
    : verificationMode && !liveMode
      ? "VERIFICATION_MODE_UNSUPPORTED"
      : "CONFIGURATION_INCOMPLETE";

  return {
    // `ready` is the canonical operator/acceptance shorthand. Keep the explicit
    // runtime fields as well so consumers can distinguish configuration from
    // activation and transport availability without reimplementing policy.
    ready: runtimeAvailable,
    configured,
    activation_ready: activation.ready,
    activation_blockers: activation.blockers,
    runtime_available: runtimeAvailable,
    runtime_status: runtimeStatus,
    business_dispatch_available: runtimeAvailable && mappingMode === "mapped" && mappingErrors.length === 0,
    direction,
    inbound_path_suffix: text(inbound.inbound_path_suffix) || null,
    verification_mode: verificationMode || null,
    required_secret_kind: requiredSecretKind,
    mapping_mode: mappingMode || null,
    mapping_errors: mappingErrors.slice(0, 20),
    checks,
  };
}

function buildOutboundReadiness(profile, credentialStatuses = {}) {
  const identity = profile?.identity || {};
  const outbound = profile?.outbound || {};
  const direction = text(identity.direction).toLowerCase();
  const authMode = text(outbound.auth_mode).toLowerCase();
  const probeMethod = text(outbound.test_request_method).toUpperCase();
  const requiredSecretKind = requiredOutboundSecretKind(profile);
  const requestDefaults = outboundRequestDefaults(profile);
  const bodyEncoding = text(requestDefaults.body_encoding).toLowerCase();
  const responseEncoding = text(requestDefaults.response_encoding).toLowerCase();
  const activation = buildConnectionActivationStatus(profile, credentialStatuses);

  const checks = [
    {
      code: "DIRECTION",
      ok: ["outbound", "both"].includes(direction),
      message: "Connection direction permits outbound traffic.",
    },
    {
      code: "BASE_URL",
      ok: Boolean(text(outbound.base_url)),
      message: "Outbound base URL is configured.",
    },
    {
      code: "AUTH_MODE",
      ok: Boolean(authMode) && LIVE_OUTBOUND_AUTH_MODES.has(authMode),
      message: "Outbound authentication mode is implemented by the connection runtime.",
    },
    {
      code: "TEST_METHOD",
      ok: SAFE_CONNECTION_PROBE_METHODS.has(probeMethod),
      message: "Endpoint health-check method is configured as safe GET or HEAD.",
    },
    {
      code: "BODY_ENCODING",
      ok: !bodyEncoding || SUPPORTED_OUTBOUND_BODY_ENCODINGS.has(bodyEncoding),
      message: "Default outbound request body format is supported.",
    },
    {
      code: "RESPONSE_ENCODING",
      ok: !responseEncoding || SUPPORTED_OUTBOUND_RESPONSE_ENCODINGS.has(responseEncoding),
      message: "Default outbound response format is supported.",
    },
    {
      code: "CREDENTIAL",
      ok: secretConfigured(credentialStatuses, requiredSecretKind),
      message: requiredSecretKind
        ? `Required ${requiredSecretKind} credential is configured.`
        : "Outbound authentication mode does not require a stored credential.",
    },
  ];

  const configured = checks.every((check) => check.ok);
  const runtimeAvailable = configured && activation.ready;
  return {
    ready: runtimeAvailable,
    configured,
    activation_ready: activation.ready,
    activation_blockers: activation.blockers,
    runtime_available: runtimeAvailable,
    runtime_status: runtimeAvailable ? "AVAILABLE" : "CONFIGURATION_INCOMPLETE",
    direction,
    auth_mode: authMode || null,
    probe_method: probeMethod || null,
    required_secret_kind: requiredSecretKind,
    request_body_encoding: bodyEncoding || null,
    response_encoding: responseEncoding || null,
    checks,
  };
}

export {
  LIVE_INBOUND_MODES,
  LIVE_OUTBOUND_AUTH_MODES,
  buildInboundReadiness,
  buildOutboundReadiness,
  requiredInboundSecretKind,
  requiredOutboundSecretKind,
};
