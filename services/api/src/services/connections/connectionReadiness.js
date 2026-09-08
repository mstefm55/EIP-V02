import {
  buildConnectionActivationStatus,
  requiredInboundSecretKind,
  requiredOutboundSecretKind,
} from "./connectionActivation.js";

const LIVE_INBOUND_MODES = new Set(["none", "api_key", "hmac_signature"]);

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
  const direction = text(identity.direction).toLowerCase();
  const environment = text(identity.environment).toLowerCase();
  const verificationMode = text(verification.mode).toLowerCase();
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
      ok: Boolean(verificationMode) && !(environment === "production" && verificationMode === "none"),
      message: "Inbound verification policy is configured for this environment.",
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
  ];

  const configured = checks.every((check) => check.ok);
  const liveMode = LIVE_INBOUND_MODES.has(verificationMode);
  const runtimeAvailable = configured && liveMode;
  const runtimeStatus = runtimeAvailable
    ? "AVAILABLE"
    : verificationMode === "oauth2_jwt"
      ? "OAUTH2_JWT_RUNTIME_PENDING"
      : verificationMode && !liveMode
        ? "VERIFICATION_MODE_UNSUPPORTED"
        : "CONFIGURATION_INCOMPLETE";

  return {
    configured,
    activation_ready: activation.ready,
    activation_blockers: activation.blockers,
    runtime_available: runtimeAvailable,
    runtime_status: runtimeStatus,
    direction,
    inbound_path_suffix: text(inbound.inbound_path_suffix) || null,
    verification_mode: verificationMode || null,
    required_secret_kind: requiredSecretKind,
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
