const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SENSITIVE_KEY_PATTERN = /(?:^|[_-])(secret|password|passwd|token|api[_-]?key|private[_-]?key|authorization|cookie|ciphertext|auth[_-]?tag|iv|key[_-]?id)(?:$|[_-])/i;
const SENSITIVE_COMPACT_KEYS = new Set([
  "secret",
  "password",
  "passwd",
  "token",
  "apikey",
  "privatekey",
  "authorization",
  "cookie",
  "clientsecret",
  "accesstoken",
  "refreshtoken",
  "testtoken",
  "ciphertext",
  "ciphertextb64",
  "authtag",
  "authtagb64",
  "iv",
  "ivb64",
  "keyid",
]);

function text(value) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function optionalText(value) {
  const normalized = text(value).trim();
  return normalized || null;
}

function finiteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeArray(value, maxItems = 100) {
  return Array.isArray(value)
    ? value.slice(0, maxItems).map((entry) => optionalText(entry)).filter(Boolean)
    : [];
}

function isSensitiveKey(key) {
  const normalized = text(key).trim();
  if (!normalized) return true;
  if (FORBIDDEN_KEYS.has(normalized)) return true;
  if (SENSITIVE_KEY_PATTERN.test(normalized)) return true;
  const compact = normalized.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SENSITIVE_COMPACT_KEYS.has(compact);
}

function sanitizePublicJson(value, depth = 0) {
  if (depth > 12 || value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 20_000);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((entry) => sanitizePublicJson(entry, depth + 1));
  }
  if (typeof value !== "object") return null;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    output[key] = sanitizePublicJson(entry, depth + 1);
  }
  return output;
}

function sanitizeCredentialStatus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};

  for (const [rawKind, rawStatus] of Object.entries(value)) {
    const kind = text(rawKind).trim().toLowerCase();
    if (!kind || kind.length > 64 || FORBIDDEN_KEYS.has(kind)) continue;
    if (!rawStatus || typeof rawStatus !== "object" || Array.isArray(rawStatus)) continue;

    output[kind] = {
      configured: rawStatus.configured === true,
      status: optionalText(rawStatus.status) || "missing",
      version: finiteNumber(rawStatus.version),
      fingerprint: optionalText(rawStatus.fingerprint),
      last_rotated_at: rawStatus.last_rotated_at || null,
      revoked_at: rawStatus.revoked_at || null,
    };
  }

  return output;
}

function toConnectionSummaryDto(profile) {
  return {
    id: profile?.id || null,
    connection_code: optionalText(profile?.connection_code ?? profile?.identity?.connection_code),
    connection_name: optionalText(profile?.connection_name ?? profile?.identity?.connection_name),
    connection_kind: optionalText(profile?.connection_kind ?? profile?.identity?.connection_kind),
    direction: optionalText(profile?.direction ?? profile?.identity?.direction),
    environment: optionalText(profile?.environment ?? profile?.identity?.environment),
    is_enabled: profile?.is_enabled === true || profile?.identity?.is_enabled === true,
    health_status: optionalText(profile?.health_status ?? profile?.health?.status) || "unknown",
    last_successful_test_at: profile?.last_successful_test_at ?? profile?.health?.last_successful_test_at ?? null,
    setting_status: optionalText(profile?.setting_status) || "active",
    updated_at: profile?.updated_at || null,
  };
}

function toConnectionDetailDto(profile, credentialStatus = {}) {
  const identity = profile?.identity || {};
  const inbound = profile?.inbound || {};
  const verification = profile?.verification || {};
  const idempotency = profile?.idempotency || {};
  const outbound = profile?.outbound || {};
  const outboundAuth = outbound.auth || {};
  const routing = profile?.routing || {};
  const audit = profile?.audit || {};

  return {
    id: profile?.id || null,
    profile_version: finiteNumber(profile?.profile_version, 1),
    identity: {
      connection_name: optionalText(identity.connection_name),
      connection_code: optionalText(identity.connection_code),
      connection_kind: optionalText(identity.connection_kind),
      direction: optionalText(identity.direction),
      environment: optionalText(identity.environment),
      frontend_url: optionalText(identity.frontend_url),
      portal_url: optionalText(identity.portal_url),
      is_enabled: identity.is_enabled === true,
    },
    inbound: {
      inbound_path_suffix: optionalText(inbound.inbound_path_suffix),
      webhook_enabled: inbound.webhook_enabled === true,
      http_method: optionalText(inbound.http_method),
      expected_content_type: optionalText(inbound.expected_content_type),
      origin_allowlist: safeArray(inbound.origin_allowlist),
      raw_body_required: inbound.raw_body_required === true,
      rate_limit: {
        max: finiteNumber(inbound.rate_limit?.max),
        window_sec: finiteNumber(inbound.rate_limit?.window_sec),
      },
    },
    verification: {
      mode: optionalText(verification.mode),
      allow_unverified: verification.allow_unverified === true,
      api_key: {
        header_name: optionalText(verification.api_key?.header_name),
      },
      hmac_signature: {
        header_name: optionalText(verification.hmac_signature?.header_name),
        algorithm: optionalText(verification.hmac_signature?.algorithm),
        encoding: optionalText(verification.hmac_signature?.encoding),
        payload_mode: optionalText(verification.hmac_signature?.payload_mode),
        timestamp_header: optionalText(verification.hmac_signature?.timestamp_header),
        max_skew_sec: finiteNumber(verification.hmac_signature?.max_skew_sec),
      },
      oauth2_jwt: {
        header_name: optionalText(verification.oauth2_jwt?.header_name),
        token_prefix: optionalText(verification.oauth2_jwt?.token_prefix),
        issuer: optionalText(verification.oauth2_jwt?.issuer),
        audience: optionalText(verification.oauth2_jwt?.audience),
        jwks_url: optionalText(verification.oauth2_jwt?.jwks_url),
        max_skew_sec: finiteNumber(verification.oauth2_jwt?.max_skew_sec),
        max_age_sec: finiteNumber(verification.oauth2_jwt?.max_age_sec),
      },
    },
    idempotency: {
      event_id_location: optionalText(idempotency.event_id_location),
      event_id_key: optionalText(idempotency.event_id_key),
      idempotency_scope: optionalText(idempotency.idempotency_scope),
    },
    outbound: {
      base_url: optionalText(outbound.base_url),
      path_prefix: optionalText(outbound.path_prefix),
      auth_mode: optionalText(outbound.auth_mode),
      auth: {
        header_name: optionalText(outboundAuth.header_name),
        query_param_name: optionalText(outboundAuth.query_param_name),
        public_key_ref: optionalText(outboundAuth.public_key_ref),
        username: optionalText(outboundAuth.username),
        client_id: optionalText(outboundAuth.client_id),
        client_auth_method: optionalText(outboundAuth.client_auth_method),
        token_url: optionalText(outboundAuth.token_url),
        scope: optionalText(outboundAuth.scope),
      },
      default_headers: sanitizePublicJson(outbound.default_headers || {}) || {},
      timeout_ms: finiteNumber(outbound.timeout_ms),
      retry_policy: {
        max_retries: finiteNumber(outbound.retry_policy?.max_retries),
        backoff_ms: finiteNumber(outbound.retry_policy?.backoff_ms),
      },
      healthcheck_path: optionalText(outbound.healthcheck_path),
      test_request_method: optionalText(outbound.test_request_method),
    },
    routing: {
      channel: optionalText(routing.channel),
      protocol: optionalText(routing.protocol),
      provider_code: optionalText(routing.provider_code),
      supported_message_types: safeArray(routing.supported_message_types),
      schema_version: optionalText(routing.schema_version),
      envelope_profile: optionalText(routing.envelope_profile),
      mapping_mode: optionalText(routing.mapping_mode),
      mapping: sanitizePublicJson(routing.mapping || {}) || {},
    },
    audit: {
      audit_record_type: optionalText(audit.audit_record_type),
      redaction_policy: sanitizePublicJson(audit.redaction_policy || {}) || {},
      max_body_size: finiteNumber(audit.max_body_size),
      ip_allowlist: safeArray(audit.ip_allowlist),
      log_level: optionalText(audit.log_level),
    },
    attrs: sanitizePublicJson(profile?.attrs || {}) || {},
    health: sanitizePublicJson(profile?.health || {}) || {},
    credential_status: sanitizeCredentialStatus(credentialStatus),
    setting_status: optionalText(profile?.setting_status) || "active",
    created_at: profile?.created_at || null,
    updated_at: profile?.updated_at || null,
  };
}

export {
  isSensitiveKey,
  sanitizeCredentialStatus,
  sanitizePublicJson,
  toConnectionDetailDto,
  toConnectionSummaryDto,
};
