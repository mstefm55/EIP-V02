function text(value) {
  return String(value ?? "").trim();
}

function secretConfigured(statuses, kind) {
  if (!kind) return true;
  const status = statuses?.[kind];
  return status?.configured === true && status?.status === "active";
}

function requiredInboundSecretKind(profile) {
  const mode = text(profile?.verification?.mode).toLowerCase();
  if (mode === "api_key") return "api_key";
  if (mode === "hmac_signature") return "hmac_secret";
  return null;
}

function buildInboundReadiness(profile, credentialStatuses = {}) {
  const identity = profile?.identity || {};
  const inbound = profile?.inbound || {};
  const verification = profile?.verification || {};
  const direction = text(identity.direction).toLowerCase();
  const environment = text(identity.environment).toLowerCase();
  const verificationMode = text(verification.mode).toLowerCase();
  const requiredSecretKind = requiredInboundSecretKind(profile);

  const checks = [
    {
      code: "DIRECTION",
      ok: ["inbound", "both"].includes(direction),
      message: "Connection direction permits inbound traffic.",
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
      ok: !(environment === "production" && verification.allow_unverified === true),
      message: "Production traffic is not configured to bypass verification.",
    },
    {
      code: "CREDENTIAL",
      ok: secretConfigured(credentialStatuses, requiredSecretKind),
      message: requiredSecretKind
        ? `Required ${requiredSecretKind} credential is configured.`
        : "Verification mode does not require a stored symmetric connection credential.",
    },
  ];

  return {
    configured: checks.every((check) => check.ok),
    runtime_available: false,
    runtime_status: "PUBLIC_INBOUND_RUNTIME_NOT_RESTORED",
    direction,
    inbound_path_suffix: text(inbound.inbound_path_suffix) || null,
    verification_mode: verificationMode || null,
    required_secret_kind: requiredSecretKind,
    checks,
  };
}

export { buildInboundReadiness, requiredInboundSecretKind };
