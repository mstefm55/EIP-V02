import {
  SUPPORTED_IDEMPOTENCY_LOCATIONS,
  SUPPORTED_IDEMPOTENCY_SCOPES,
  SUPPORTED_INBOUND_VERIFICATION_MODES,
  SUPPORTED_MAPPING_MODES,
  buildConnectionActivationStatus,
  requiredInboundSecretKind,
  requiredOutboundSecretKind,
} from "./connectionActivation.js";
import { validateInboundMappingConfig } from "./connectionInboundMapping.js";

const LIVE_INBOUND_MODES = SUPPORTED_INBOUND_VERIFICATION_MODES;

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
      ok: Boolean(text(inbound.inbound_path_suffix)),
      message: "Inbound path suffix is configured.",
    },
    {
      code: "HTTP_METHOD",
      ok: Boolean(text(inbound.http_method)),
      message: "Inbound HTTP method is configured.",
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
      message: "Inbound verification uses a governed EIP connection verification mode.",
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
  const runtimeAvailable = configured && liveMode;
  const runtimeStatus = runtimeAvailable
    ? "AVAILABLE"
    : verificationMode && !liveMode
      ? "VERIFICATION_MODE_UNSUPPORTED"
      : "CONFIGURATION_INCOMPLETE";

  return {
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
  const requiredSecretKind = requiredOutboundSecretKind(profile);
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
      ok: Boolean(authMode),
      message: "Outbound authentication mode is configured.",
    },
    {
      code: "TEST_METHOD",
      ok: Boolean(text(outbound.test_request_method)),
      message: "Outbound test method is configured.",
    },
    {
      code: "CREDENTIAL",
      ok: secretConfigured(credentialStatuses, requiredSecretKind),
      message: requiredSecretKind
        ? `Required ${requiredSecretKind} credential is configured.`
        : "Outbound authentication mode does not require a stored credential.",
    },
  ];

  return {
    configured: checks.every((check) => check.ok),
    direction,
    auth_mode: authMode || null,
    required_secret_kind: requiredSecretKind,
    checks,
  };
}

export {
  LIVE_INBOUND_MODES,
  buildInboundReadiness,
  buildOutboundReadiness,
  requiredInboundSecretKind,
  requiredOutboundSecretKind,
};
