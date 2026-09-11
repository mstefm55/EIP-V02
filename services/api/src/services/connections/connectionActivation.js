import { validateInboundMappingConfig } from "./connectionInboundMapping.js";
import { inspectInboundRateLimit } from "./connectionRateLimitPolicy.js";
import {
  isSupportedInboundHttpMethod,
  isValidInboundSuffix,
} from "./connectionInboundPolicy.js";

const SUPPORTED_INBOUND_VERIFICATION_MODES = new Set([
  "none",
  "api_key",
  "hmac_signature",
  "provider_signature",
]);
const SUPPORTED_PROVIDER_SIGNATURES = new Set(["stripe", "paypal"]);
const SUPPORTED_OUTBOUND_AUTH_MODES = new Set([
  "none",
  "bearer",
  "api_key_header",
  "api_key_query",
  "basic",
  "oauth2_client_credentials",
]);
const SUPPORTED_OUTBOUND_BODY_ENCODINGS = new Set(["none", "json", "form", "text", "base64"]);
const SUPPORTED_OUTBOUND_RESPONSE_ENCODINGS = new Set(["auto", "json", "text", "base64"]);
const SUPPORTED_IDEMPOTENCY_LOCATIONS = new Set(["header", "query", "body"]);
const SUPPORTED_IDEMPOTENCY_SCOPES = new Set(["connection", "tenant"]);
const SUPPORTED_MAPPING_MODES = new Set(["passthrough", "mapped"]);
const SAFE_CONNECTION_PROBE_METHODS = new Set(["GET", "HEAD"]);

function text(value) {
  return String(value ?? "").trim();
}

function activeSecret(statuses, kind) {
  if (!kind) return true;
  const status = statuses?.[kind];
  return status?.configured === true && status?.status === "active";
}

function providerSignatureConfig(profile) {
  const configured = profile?.attrs?.provider_signature;
  return configured && typeof configured === "object" && !Array.isArray(configured) ? configured : {};
}

function providerSignatureCode(profile) {
  return text(
    providerSignatureConfig(profile).provider_code
      || profile?.routing?.provider_code
  ).toLowerCase();
}

function outboundRequestDefaults(profile) {
  const configured = profile?.attrs?.outbound_request;
  return configured && typeof configured === "object" && !Array.isArray(configured) ? configured : {};
}

function oauthClientCredentialsConfig(profile) {
  const configured = profile?.attrs?.oauth_client_credentials;
  return configured && typeof configured === "object" && !Array.isArray(configured) ? configured : {};
}

function requiredInboundSecretKind(profile) {
  const mode = text(profile?.verification?.mode).toLowerCase();
  if (mode === "api_key") return "api_key";
  if (mode === "hmac_signature") return "hmac_secret";
  if (mode === "provider_signature" && providerSignatureCode(profile) === "stripe") {
    return text(providerSignatureConfig(profile).secret_kind || "webhook_signing_secret").toLowerCase();
  }
  return null;
}

function requiredOutboundSecretKind(profile) {
  const mode = text(profile?.outbound?.auth_mode).toLowerCase();
  if (mode === "bearer") return "bearer_token";
  if (mode === "api_key_header" || mode === "api_key_query") return "api_key";
  if (mode === "basic") return "basic_password";
  if (mode === "oauth2_client_credentials") return "oauth_client_secret";
  return null;
}

function requiredConnectionCredentialKinds(profile) {
  const direction = text(profile?.identity?.direction).toLowerCase();
  const required = new Set();
  if (["inbound", "both"].includes(direction)) {
    const kind = requiredInboundSecretKind(profile);
    if (kind) required.add(kind);
  }
  if (["outbound", "both"].includes(direction)) {
    const kind = requiredOutboundSecretKind(profile);
    if (kind) required.add(kind);
  }
  return [...required];
}

function validateConnectionActivation(profile, credentialStatuses = {}) {
  const errors = [];
  const add = (path, code, message) => errors.push({ path, code, message });
  const identity = profile?.identity || {};
  const inbound = profile?.inbound || {};
  const verification = profile?.verification || {};
  const idempotency = profile?.idempotency || {};
  const routing = profile?.routing || {};
  const audit = profile?.audit || {};
  const outbound = profile?.outbound || {};
  const outboundAuth = outbound.auth || {};
  const direction = text(identity.direction).toLowerCase();
  const environment = text(identity.environment).toLowerCase();
  const verificationMode = text(verification.mode).toLowerCase();
  const outboundAuthMode = text(outbound.auth_mode).toLowerCase();
  const eventLocation = text(idempotency.event_id_location).toLowerCase();
  const idempotencyScope = text(idempotency.idempotency_scope).toLowerCase();
  const mappingMode = text(routing.mapping_mode).toLowerCase();
  const rateLimit = inspectInboundRateLimit(profile);
  const providerConfig = providerSignatureConfig(profile);
  const providerCode = providerSignatureCode(profile);
  const requestDefaults = outboundRequestDefaults(profile);
  const oauthConfig = oauthClientCredentialsConfig(profile);

  if (!["inbound", "outbound", "both"].includes(direction)) {
    add("identity.direction", "ACTIVATION_DIRECTION_REQUIRED", "Connection direction must be configured before activation.");
  }

  // Keep the activation/readiness contract aligned with the canonical seven-step
  // operator flow. These are governed profile requirements already enforced by
  // persistence validation; surfacing them here prevents a false green readiness
  // state followed by an activation rejection.
  if (!text(routing.channel)) {
    add("routing.channel", "ACTIVATION_CHANNEL_REQUIRED", "Routing channel must be configured before activation.");
  }
  if (!mappingMode || !SUPPORTED_MAPPING_MODES.has(mappingMode)) {
    add("routing.mapping_mode", "ACTIVATION_MAPPING_MODE_REQUIRED", "A supported routing mapping mode is required before activation.");
  }
  if (!text(routing.schema_version)) {
    add("routing.schema_version", "ACTIVATION_SCHEMA_VERSION_REQUIRED", "Routing schema version must be configured before activation.");
  }
  if (!text(routing.envelope_profile)) {
    add("routing.envelope_profile", "ACTIVATION_ENVELOPE_PROFILE_REQUIRED", "Routing envelope profile must be configured before activation.");
  }
  if (!text(audit.log_level)) {
    add("audit.log_level", "ACTIVATION_LOG_LEVEL_REQUIRED", "Audit log level must be configured before activation.");
  }

  if (["inbound", "both"].includes(direction)) {
    if (!inbound.webhook_enabled) {
      add("inbound.webhook_enabled", "ACTIVATION_INBOUND_DISABLED", "Inbound transport must be enabled before activating an inbound connection.");
    }
    const inboundSuffix = text(inbound.inbound_path_suffix);
    if (!inboundSuffix) {
      add("inbound.inbound_path_suffix", "ACTIVATION_INBOUND_PATH_REQUIRED", "Inbound path suffix is required before activation.");
    } else if (!isValidInboundSuffix(inboundSuffix)) {
      add(
        "inbound.inbound_path_suffix",
        "ACTIVATION_INBOUND_PATH_INVALID",
        "Inbound path suffix must start with a letter or number and use only letters, numbers, underscore or hyphen (maximum 128 characters)."
      );
    }
    const inboundMethod = text(inbound.http_method).toUpperCase();
    if (!inboundMethod) {
      add("inbound.http_method", "ACTIVATION_INBOUND_METHOD_REQUIRED", "Inbound HTTP method is required before activation.");
    } else if (!isSupportedInboundHttpMethod(inboundMethod)) {
      add(
        "inbound.http_method",
        "ACTIVATION_INBOUND_HTTP_METHOD_UNSUPPORTED",
        "Live inbound Connections support POST, PUT or PATCH."
      );
    }
    if (!text(inbound.expected_content_type)) {
      add("inbound.expected_content_type", "ACTIVATION_CONTENT_TYPE_REQUIRED", "Expected inbound content type is required before activation.");
    }
    if (!verificationMode) {
      add("verification.mode", "ACTIVATION_VERIFICATION_REQUIRED", "Inbound verification mode is required before activation.");
    }
    if (verificationMode && !SUPPORTED_INBOUND_VERIFICATION_MODES.has(verificationMode)) {
      add(
        "verification.mode",
        "ACTIVATION_VERIFICATION_UNSUPPORTED",
        "Inbound verification must use an implemented governed EIP connection verification mode."
      );
    }
    if (environment === "production" && verificationMode === "none") {
      add("verification.mode", "ACTIVATION_PRODUCTION_VERIFICATION_REQUIRED", "Production inbound connections require request verification.");
    }
    if (environment === "production" && verification.allow_unverified === true) {
      add("verification.allow_unverified", "ACTIVATION_UNVERIFIED_FORBIDDEN", "Production inbound connections cannot allow unverified requests.");
    }

    if (verificationMode === "api_key" && !text(verification.api_key?.header_name)) {
      add("verification.api_key.header_name", "ACTIVATION_API_KEY_HEADER_REQUIRED", "API-key verification requires a header name.");
    }
    if (verificationMode === "hmac_signature") {
      if (!text(verification.hmac_signature?.header_name)) {
        add("verification.hmac_signature.header_name", "ACTIVATION_HMAC_HEADER_REQUIRED", "HMAC verification requires a signature header name.");
      }
      if (!text(verification.hmac_signature?.algorithm)) {
        add("verification.hmac_signature.algorithm", "ACTIVATION_HMAC_ALGORITHM_REQUIRED", "HMAC verification requires an algorithm.");
      }
      if (!text(verification.hmac_signature?.encoding)) {
        add("verification.hmac_signature.encoding", "ACTIVATION_HMAC_ENCODING_REQUIRED", "HMAC verification requires an encoding.");
      }
      if (!text(verification.hmac_signature?.payload_mode)) {
        add("verification.hmac_signature.payload_mode", "ACTIVATION_HMAC_PAYLOAD_REQUIRED", "HMAC verification requires a payload mode.");
      }
      if (text(verification.hmac_signature?.payload_mode).toLowerCase() === "timestamp_sha256"
        && !text(verification.hmac_signature?.timestamp_header)) {
        add("verification.hmac_signature.timestamp_header", "ACTIVATION_HMAC_TIMESTAMP_REQUIRED", "Timestamp-based HMAC verification requires a timestamp header name.");
      }
    }
    if (verificationMode === "provider_signature") {
      if (!SUPPORTED_PROVIDER_SIGNATURES.has(providerCode)) {
        add(
          "attrs.provider_signature.provider_code",
          "ACTIVATION_PROVIDER_SIGNATURE_UNSUPPORTED",
          "Provider signature verification requires an implemented provider verifier."
        );
      }
      if (providerCode === "paypal" && !text(providerConfig.webhook_id)) {
        add(
          "attrs.provider_signature.webhook_id",
          "ACTIVATION_PAYPAL_WEBHOOK_ID_REQUIRED",
          "PayPal signature verification requires the webhook ID assigned to this listener."
        );
      }
      const maxSkew = providerConfig.max_skew_sec;
      if (maxSkew !== undefined && maxSkew !== null && maxSkew !== "") {
        const parsedSkew = Number(maxSkew);
        if (!Number.isFinite(parsedSkew) || parsedSkew < 0 || parsedSkew > 3600) {
          add(
            "attrs.provider_signature.max_skew_sec",
            "ACTIVATION_PROVIDER_SIGNATURE_SKEW_INVALID",
            "Provider signature timestamp tolerance must be between 0 and 3600 seconds."
          );
        }
      }
    }

    if (!SUPPORTED_IDEMPOTENCY_LOCATIONS.has(eventLocation)) {
      add("idempotency.event_id_location", "ACTIVATION_IDEMPOTENCY_LOCATION_REQUIRED", "Inbound idempotency requires a governed event ID location.");
    }
    if (!text(idempotency.event_id_key)) {
      add("idempotency.event_id_key", "ACTIVATION_IDEMPOTENCY_KEY_REQUIRED", "Inbound idempotency requires an event ID key/path.");
    }
    if (!SUPPORTED_IDEMPOTENCY_SCOPES.has(idempotencyScope)) {
      add("idempotency.idempotency_scope", "ACTIVATION_IDEMPOTENCY_SCOPE_REQUIRED", "Inbound idempotency requires a governed scope.");
    }
    if (mappingMode === "mapped") {
      for (const mappingIssue of validateInboundMappingConfig(profile, { requireMapped: true })) {
        add(mappingIssue.path, `ACTIVATION_${mappingIssue.code}`, mappingIssue.message);
      }
    }
    if (rateLimit.configured && !rateLimit.valid) {
      for (const rateIssue of rateLimit.errors) {
        add(rateIssue.path, `ACTIVATION_${rateIssue.code}`, rateIssue.message);
      }
    }
  }

  if (["outbound", "both"].includes(direction)) {
    if (!text(outbound.base_url)) {
      add("outbound.base_url", "ACTIVATION_OUTBOUND_URL_REQUIRED", "Outbound base URL is required before activation.");
    }
    if (!outboundAuthMode) {
      add("outbound.auth_mode", "ACTIVATION_OUTBOUND_AUTH_REQUIRED", "Outbound authentication mode is required before activation.");
    } else if (!SUPPORTED_OUTBOUND_AUTH_MODES.has(outboundAuthMode)) {
      add(
        "outbound.auth_mode",
        "ACTIVATION_OUTBOUND_AUTH_UNSUPPORTED",
        "Outbound authentication mode is not implemented by the connection runtime."
      );
    }
    if (outboundAuthMode === "api_key_header" && !text(outboundAuth.header_name)) {
      add("outbound.auth.header_name", "ACTIVATION_OUTBOUND_API_KEY_HEADER_REQUIRED", "Outbound API-key header authentication requires a header name.");
    }
    if (outboundAuthMode === "api_key_query" && !text(outboundAuth.query_param_name)) {
      add("outbound.auth.query_param_name", "ACTIVATION_OUTBOUND_API_KEY_QUERY_REQUIRED", "Outbound API-key query authentication requires a query parameter name.");
    }
    if (outboundAuthMode === "basic" && !text(outboundAuth.username)) {
      add("outbound.auth.username", "ACTIVATION_BASIC_USERNAME_REQUIRED", "Basic authentication requires a username.");
    }
    if (outboundAuthMode === "oauth2_client_credentials") {
      if (!text(outboundAuth.client_id)) {
        add("outbound.auth.client_id", "ACTIVATION_OAUTH_CLIENT_ID_REQUIRED", "OAuth2 client credentials require a client ID.");
      }
      if (!text(outboundAuth.token_url)) {
        add("outbound.auth.token_url", "ACTIVATION_OAUTH_TOKEN_URL_REQUIRED", "OAuth2 client credentials require a token URL.");
      }
      const clientAuthMethod = text(oauthConfig.client_auth_method || outboundAuth.client_auth_method || "basic").toLowerCase();
      if (!["basic", "body", "client_secret_basic", "client_secret_post"].includes(clientAuthMethod)) {
        add(
          "attrs.oauth_client_credentials.client_auth_method",
          "ACTIVATION_OAUTH_CLIENT_AUTH_UNSUPPORTED",
          "OAuth client authentication must use Basic or request-body client credentials."
        );
      }
    }

    const probeMethod = text(outbound.test_request_method).toUpperCase();
    if (!probeMethod) {
      add("outbound.test_request_method", "ACTIVATION_PROBE_METHOD_REQUIRED", "Endpoint health-check method must be configured before activation.");
    } else if (!SAFE_CONNECTION_PROBE_METHODS.has(probeMethod)) {
      add(
        "outbound.test_request_method",
        "ACTIVATION_PROBE_METHOD_UNSAFE",
        "Endpoint health checks are restricted to GET or HEAD. Use Authenticated request test for mutating methods."
      );
    }

    const bodyEncoding = text(requestDefaults.body_encoding).toLowerCase();
    if (bodyEncoding && !SUPPORTED_OUTBOUND_BODY_ENCODINGS.has(bodyEncoding)) {
      add(
        "attrs.outbound_request.body_encoding",
        "ACTIVATION_OUTBOUND_BODY_ENCODING_UNSUPPORTED",
        "Configured outbound body encoding is not implemented by the connection runtime."
      );
    }
    const responseEncoding = text(requestDefaults.response_encoding).toLowerCase();
    if (responseEncoding && !SUPPORTED_OUTBOUND_RESPONSE_ENCODINGS.has(responseEncoding)) {
      add(
        "attrs.outbound_request.response_encoding",
        "ACTIVATION_OUTBOUND_RESPONSE_ENCODING_UNSUPPORTED",
        "Configured outbound response encoding is not implemented by the connection runtime."
      );
    }
  }

  for (const kind of requiredConnectionCredentialKinds(profile)) {
    if (!activeSecret(credentialStatuses, kind)) {
      add(
        `credentials.${kind}`,
        "ACTIVATION_CREDENTIAL_REQUIRED",
        `Active ${kind} credential is required before activation.`
      );
    }
  }

  return errors;
}

function buildConnectionActivationStatus(profile, credentialStatuses = {}) {
  const errors = validateConnectionActivation(profile, credentialStatuses);
  return {
    ready: errors.length === 0,
    required_secret_kinds: requiredConnectionCredentialKinds(profile),
    blockers: errors,
  };
}

export {
  SAFE_CONNECTION_PROBE_METHODS,
  SUPPORTED_IDEMPOTENCY_LOCATIONS,
  SUPPORTED_IDEMPOTENCY_SCOPES,
  SUPPORTED_INBOUND_VERIFICATION_MODES,
  SUPPORTED_MAPPING_MODES,
  SUPPORTED_OUTBOUND_AUTH_MODES,
  SUPPORTED_OUTBOUND_BODY_ENCODINGS,
  SUPPORTED_OUTBOUND_RESPONSE_ENCODINGS,
  SUPPORTED_PROVIDER_SIGNATURES,
  activeSecret,
  buildConnectionActivationStatus,
  oauthClientCredentialsConfig,
  outboundRequestDefaults,
  providerSignatureCode,
  providerSignatureConfig,
  requiredConnectionCredentialKinds,
  requiredInboundSecretKind,
  requiredOutboundSecretKind,
  validateConnectionActivation,
};
