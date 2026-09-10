import crypto from "node:crypto";
import { withTenantTransaction } from "../../db/tenantTransaction.js";
import { validateConnectionActivation } from "./connectionActivation.js";

const PROFILE_KEY_PREFIX = "connection.profile.";
const CONNECTION_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const MAX_CONNECTION_CODE_ALLOCATION_ATTEMPTS = 10000;
const PROHIBITED_SECRET_KEYS = new Set([
  "secret",
  "client_secret",
  "clientsecret",
  "password",
  "token",
  "test_token",
  "private_key",
  "privatekey",
  "bearer_token",
  "api_key_value",
  "secret_ref",
  "client_secret_ref",
  "password_ref",
  "token_ref",
]);
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

class ConnectionProfileError extends Error {
  constructor(message, code, status = 400, details = []) {
    super(message);
    this.name = "ConnectionProfileError";
    this.code = code;
    this.status = status;
    this.details = Array.isArray(details) ? details : [];
    this.errors = this.details;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function bool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function boundedNumber(value, fallback, min, max) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeStringArray(value, maxItems = 100, maxLength = 500) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((entry) => text(entry).slice(0, maxLength))
    .filter(Boolean);
}

function sanitizeJson(value, depth = 0) {
  if (depth > 16) return null;
  if (value === null || value === undefined) return null;
  if (["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((entry) => sanitizeJson(entry, depth + 1));
  }
  if (typeof value !== "object") return null;

  const output = {};
  for (const [rawKey, entry] of Object.entries(value)) {
    const key = text(rawKey);
    const normalizedKey = key.toLowerCase();
    if (!key || FORBIDDEN_OBJECT_KEYS.has(key) || PROHIBITED_SECRET_KEYS.has(normalizedKey)) continue;
    output[key] = sanitizeJson(entry, depth + 1);
  }
  return output;
}

function normalizeConnectionCode(value) {
  const code = text(value).toLowerCase();
  if (!CONNECTION_CODE_PATTERN.test(code)) {
    throw new ConnectionProfileError(
      "Connection code must be 3-64 characters using lowercase letters, numbers, underscore or hyphen.",
      "CONNECTION_CODE_INVALID",
      400
    );
  }
  return code;
}

// V1 created Connection record identifiers with a fixed `conn-` prefix and a
// serial number. Keep that protocol independent from the human Connection name.
function buildConnectionCodeBase() {
  return "conn";
}

function buildConnectionCodeCandidate(_value, serial = 1) {
  const normalizedSerial = Number.isInteger(serial) && serial > 0 ? serial : 1;
  return normalizeConnectionCode(`${buildConnectionCodeBase()}-${normalizedSerial}`);
}

function profileKey(connectionCode) {
  return `${PROFILE_KEY_PREFIX}${normalizeConnectionCode(connectionCode)}`;
}

function normalizeHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = text(rawKey);
    if (!key || key.length > 100) continue;
    const headerValue = text(rawValue);
    if (!headerValue || headerValue.length > 1000) continue;
    const lower = key.toLowerCase();
    if (["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key"].includes(lower)) continue;
    output[key] = headerValue;
  }
  return output;
}

function readNested(source, previous, path, fallback = "") {
  const parts = path.split(".");
  let current = source;
  for (const part of parts) current = current && typeof current === "object" ? current[part] : undefined;
  if (current !== undefined && current !== null) return current;
  current = previous;
  for (const part of parts) current = current && typeof current === "object" ? current[part] : undefined;
  return current !== undefined && current !== null ? current : fallback;
}

function normalizeProfile(input, existing = null) {
  const source = sanitizeJson(input) || {};
  const previous = existing && typeof existing === "object" ? existing : {};
  const identitySource = source.identity && typeof source.identity === "object" ? source.identity : {};
  const previousIdentity = previous.identity && typeof previous.identity === "object" ? previous.identity : {};
  const connectionName = text(identitySource.connection_name ?? previousIdentity.connection_name);
  const requestedConnectionCode = text(
    identitySource.connection_code || previousIdentity.connection_code || source.connection_code
  );
  const connectionCode = requestedConnectionCode
    ? normalizeConnectionCode(requestedConnectionCode)
    : buildConnectionCodeCandidate(connectionName, 1);

  const inboundSource = source.inbound && typeof source.inbound === "object" ? source.inbound : {};
  const verificationSource = source.verification && typeof source.verification === "object" ? source.verification : {};
  const idempotencySource = source.idempotency && typeof source.idempotency === "object" ? source.idempotency : {};
  const outboundSource = source.outbound && typeof source.outbound === "object" ? source.outbound : {};
  const outboundAuthSource = outboundSource.auth && typeof outboundSource.auth === "object" ? outboundSource.auth : {};
  const routingSource = source.routing && typeof source.routing === "object" ? source.routing : {};
  const auditSource = source.audit && typeof source.audit === "object" ? source.audit : {};

  const previousInbound = previous.inbound || {};
  const previousVerification = previous.verification || {};
  const previousIdempotency = previous.idempotency || {};
  const previousOutbound = previous.outbound || {};
  const previousOutboundAuth = previousOutbound.auth || {};
  const previousRouting = previous.routing || {};
  const previousAudit = previous.audit || {};

  return {
    profile_version: 1,
    identity: {
      connection_name: connectionName,
      connection_code: connectionCode,
      connection_kind: text(identitySource.connection_kind ?? previousIdentity.connection_kind),
      direction: text(identitySource.direction ?? previousIdentity.direction),
      environment: text(identitySource.environment ?? previousIdentity.environment),
      frontend_url: text(identitySource.frontend_url ?? previousIdentity.frontend_url),
      portal_url: text(identitySource.portal_url ?? previousIdentity.portal_url),
      is_enabled: bool(
        identitySource.is_enabled,
        previousIdentity.is_enabled !== undefined ? previousIdentity.is_enabled === true : false
      ),
    },
    inbound: {
      inbound_path_suffix: text(inboundSource.inbound_path_suffix ?? previousInbound.inbound_path_suffix),
      webhook_enabled: bool(
        inboundSource.webhook_enabled,
        previousInbound.webhook_enabled === true
      ),
      http_method: text(inboundSource.http_method ?? previousInbound.http_method).toUpperCase(),
      expected_content_type: text(inboundSource.expected_content_type ?? previousInbound.expected_content_type),
      origin_allowlist: normalizeStringArray(
        inboundSource.origin_allowlist ?? previousInbound.origin_allowlist,
        100,
        500
      ),
      raw_body_required: bool(
        inboundSource.raw_body_required,
        previousInbound.raw_body_required === true
      ),
      rate_limit: {
        max: boundedNumber(
          inboundSource.rate_limit?.max ?? previousInbound.rate_limit?.max,
          null,
          1,
          1_000_000
        ),
        window_sec: boundedNumber(
          inboundSource.rate_limit?.window_sec ?? previousInbound.rate_limit?.window_sec,
          null,
          1,
          86_400
        ),
      },
    },
    verification: {
      mode: text(verificationSource.mode ?? previousVerification.mode),
      allow_unverified: bool(
        verificationSource.allow_unverified,
        previousVerification.allow_unverified === true
      ),
      api_key: {
        header_name: text(verificationSource.api_key?.header_name ?? previousVerification.api_key?.header_name),
      },
      hmac_signature: {
        header_name: text(verificationSource.hmac_signature?.header_name ?? previousVerification.hmac_signature?.header_name),
        algorithm: text(verificationSource.hmac_signature?.algorithm ?? previousVerification.hmac_signature?.algorithm),
        encoding: text(verificationSource.hmac_signature?.encoding ?? previousVerification.hmac_signature?.encoding),
        payload_mode: text(verificationSource.hmac_signature?.payload_mode ?? previousVerification.hmac_signature?.payload_mode),
        timestamp_header: text(verificationSource.hmac_signature?.timestamp_header ?? previousVerification.hmac_signature?.timestamp_header),
        max_skew_sec: boundedNumber(
          verificationSource.hmac_signature?.max_skew_sec ?? previousVerification.hmac_signature?.max_skew_sec,
          null,
          0,
          3600
        ),
      },
      oauth2_jwt: {
        header_name: text(verificationSource.oauth2_jwt?.header_name ?? previousVerification.oauth2_jwt?.header_name),
        token_prefix: text(verificationSource.oauth2_jwt?.token_prefix ?? previousVerification.oauth2_jwt?.token_prefix),
        issuer: text(verificationSource.oauth2_jwt?.issuer ?? previousVerification.oauth2_jwt?.issuer),
        audience: text(verificationSource.oauth2_jwt?.audience ?? previousVerification.oauth2_jwt?.audience),
        jwks_url: text(verificationSource.oauth2_jwt?.jwks_url ?? previousVerification.oauth2_jwt?.jwks_url),
        max_skew_sec: boundedNumber(
          verificationSource.oauth2_jwt?.max_skew_sec ?? previousVerification.oauth2_jwt?.max_skew_sec,
          null,
          0,
          3600
        ),
        max_age_sec: boundedNumber(
          verificationSource.oauth2_jwt?.max_age_sec ?? previousVerification.oauth2_jwt?.max_age_sec,
          null,
          1,
          86_400
        ),
      },
    },
    idempotency: {
      event_id_location: text(idempotencySource.event_id_location ?? previousIdempotency.event_id_location),
      event_id_key: text(idempotencySource.event_id_key ?? previousIdempotency.event_id_key),
      idempotency_scope: text(idempotencySource.idempotency_scope ?? previousIdempotency.idempotency_scope),
    },
    outbound: {
      base_url: text(outboundSource.base_url ?? previousOutbound.base_url),
      path_prefix: text(outboundSource.path_prefix ?? previousOutbound.path_prefix),
      auth_mode: text(outboundSource.auth_mode ?? previousOutbound.auth_mode),
      auth: {
        header_name: text(outboundAuthSource.header_name ?? previousOutboundAuth.header_name),
        query_param_name: text(outboundAuthSource.query_param_name ?? previousOutboundAuth.query_param_name),
        public_key_ref: text(outboundAuthSource.public_key_ref ?? previousOutboundAuth.public_key_ref),
        username: text(outboundAuthSource.username ?? previousOutboundAuth.username),
        client_id: text(outboundAuthSource.client_id ?? previousOutboundAuth.client_id),
        client_auth_method: text(outboundAuthSource.client_auth_method ?? previousOutboundAuth.client_auth_method),
        token_url: text(outboundAuthSource.token_url ?? previousOutboundAuth.token_url),
        scope: text(outboundAuthSource.scope ?? previousOutboundAuth.scope),
      },
      default_headers: normalizeHeaders(outboundSource.default_headers ?? previousOutbound.default_headers),
      timeout_ms: boundedNumber(outboundSource.timeout_ms ?? previousOutbound.timeout_ms, null, 250, 30_000),
      retry_policy: {
        max_retries: boundedNumber(
          outboundSource.retry_policy?.max_retries ?? previousOutbound.retry_policy?.max_retries,
          null,
          0,
          5
        ),
        backoff_ms: boundedNumber(
          outboundSource.retry_policy?.backoff_ms ?? previousOutbound.retry_policy?.backoff_ms,
          null,
          50,
          30_000
        ),
      },
      healthcheck_path: text(outboundSource.healthcheck_path ?? previousOutbound.healthcheck_path),
      test_request_method: text(outboundSource.test_request_method ?? previousOutbound.test_request_method).toUpperCase(),
    },
    routing: {
      channel: text(routingSource.channel ?? previousRouting.channel),
      protocol: text(routingSource.protocol ?? previousRouting.protocol),
      provider_code: text(routingSource.provider_code ?? previousRouting.provider_code),
      supported_message_types: normalizeStringArray(
        routingSource.supported_message_types ?? previousRouting.supported_message_types,
        100,
        100
      ),
      schema_version: text(routingSource.schema_version ?? previousRouting.schema_version),
      envelope_profile: text(routingSource.envelope_profile ?? previousRouting.envelope_profile),
      mapping_mode: text(routingSource.mapping_mode ?? previousRouting.mapping_mode),
      mapping: sanitizeJson(routingSource.mapping ?? previousRouting.mapping ?? {}) || {},
    },
    audit: {
      audit_record_type: text(auditSource.audit_record_type ?? previousAudit.audit_record_type),
      redaction_policy: sanitizeJson(auditSource.redaction_policy ?? previousAudit.redaction_policy ?? {}) || {},
      max_body_size: boundedNumber(auditSource.max_body_size ?? previousAudit.max_body_size, null, 1024, 5_242_880),
      ip_allowlist: normalizeStringArray(auditSource.ip_allowlist ?? previousAudit.ip_allowlist, 100, 100),
      log_level: text(auditSource.log_level ?? previousAudit.log_level),
    },
    attrs: sanitizeJson(source.attrs ?? previous.attrs ?? {}) || {},
    health: previous.health && typeof previous.health === "object" ? sanitizeJson(previous.health) || {} : {},
    credential_status:
      previous.credential_status && typeof previous.credential_status === "object"
        ? sanitizeJson(previous.credential_status) || {}
        : {},
  };
}

function taxonomySet(taxonomy, code) {
  const values = Array.isArray(taxonomy?.[code]) ? taxonomy[code] : [];
  return new Set(values.map((entry) => text(entry?.code ?? entry)).filter(Boolean));
}

function validateGovernedValue(errors, taxonomy, listCode, value, path, { required = false } = {}) {
  const allowed = taxonomySet(taxonomy, listCode);
  const normalized = text(value);
  if (required && !normalized) {
    errors.push({ path, code: "REQUIRED", message: `${path} is required.` });
    return;
  }
  if (normalized && allowed.size > 0 && !allowed.has(normalized)) {
    errors.push({
      path,
      code: "GOVERNED_VALUE_INVALID",
      message: `${path} must use an active ${listCode} value.`,
    });
  }
}

function validateConnectionProfile(profile, taxonomy = {}, options = {}) {
  const errors = [];
  const add = (path, code, message) => errors.push({ path, code, message });
  const identity = profile?.identity || {};
  const requireComplete = options.requireComplete ?? identity.is_enabled === true;
  const direction = text(identity.direction).toLowerCase();
  const inboundRequired = requireComplete && ["inbound", "both"].includes(direction);
  const outboundRequired = requireComplete && ["outbound", "both"].includes(direction);

  if (!identity.connection_name) add("identity.connection_name", "REQUIRED", "Connection name is required.");
  if (!identity.connection_code) add("identity.connection_code", "REQUIRED", "Connection code is required.");

  validateGovernedValue(errors, taxonomy, "CONNECTION_KIND", identity.connection_kind, "identity.connection_kind", { required: true });
  validateGovernedValue(errors, taxonomy, "CONNECTION_DIRECTION", identity.direction, "identity.direction", { required: requireComplete });
  validateGovernedValue(errors, taxonomy, "CONNECTION_ENVIRONMENT", identity.environment, "identity.environment", { required: true });

  if (["inbound", "both"].includes(direction)) {
    validateGovernedValue(
      errors,
      taxonomy,
      "CONNECTION_VERIFICATION_MODE",
      profile?.verification?.mode,
      "verification.mode",
      { required: inboundRequired }
    );
    validateGovernedValue(
      errors,
      taxonomy,
      "CONNECTION_EVENT_ID_LOCATION",
      profile?.idempotency?.event_id_location,
      "idempotency.event_id_location",
      { required: inboundRequired }
    );
    validateGovernedValue(
      errors,
      taxonomy,
      "CONNECTION_IDEMPOTENCY_SCOPE",
      profile?.idempotency?.idempotency_scope,
      "idempotency.idempotency_scope",
      { required: inboundRequired }
    );
  }

  if (["outbound", "both"].includes(direction)) {
    validateGovernedValue(
      errors,
      taxonomy,
      "CONNECTION_AUTH_MODE",
      profile?.outbound?.auth_mode,
      "outbound.auth_mode",
      { required: outboundRequired }
    );
  }

  validateGovernedValue(errors, taxonomy, "CONNECTION_CHANNEL", profile?.routing?.channel, "routing.channel", { required: requireComplete });
  validateGovernedValue(errors, taxonomy, "CONNECTION_MAPPING_MODE", profile?.routing?.mapping_mode, "routing.mapping_mode", { required: requireComplete });
  validateGovernedValue(errors, taxonomy, "CONNECTION_HTTP_METHOD", profile?.inbound?.http_method, "inbound.http_method", {
    required: inboundRequired,
  });
  validateGovernedValue(errors, taxonomy, "CONNECTION_HTTP_METHOD", profile?.outbound?.test_request_method, "outbound.test_request_method", {
    required: outboundRequired,
  });
  validateGovernedValue(errors, taxonomy, "CONNECTION_LOG_LEVEL", profile?.audit?.log_level, "audit.log_level", { required: requireComplete });

  if (["inbound", "both"].includes(direction)) {
    if (inboundRequired && !profile?.inbound?.inbound_path_suffix) {
      add("inbound.inbound_path_suffix", "REQUIRED", "Inbound path suffix is required for inbound connections.");
    }
    if (identity.environment === "production" && profile?.verification?.mode === "none") {
      add(
        "verification.mode",
        "PRODUCTION_VERIFICATION_REQUIRED",
        "Production inbound connections require a verification mode."
      );
    }
    if (identity.environment === "production" && profile?.verification?.allow_unverified === true) {
      add(
        "verification.allow_unverified",
        "PRODUCTION_UNVERIFIED_FORBIDDEN",
        "Production inbound connections cannot allow unverified requests."
      );
    }
    if (inboundRequired && !profile?.idempotency?.event_id_key) {
      add("idempotency.event_id_key", "REQUIRED", "Idempotency event key is required for inbound connections.");
    }
  }

  if (outboundRequired && !profile?.outbound?.base_url) {
    add("outbound.base_url", "REQUIRED", "Outbound base URL is required for outbound connections.");
  }

  if (requireComplete && !profile?.routing?.schema_version) {
    add("routing.schema_version", "REQUIRED", "Routing schema version is required.");
  }
  if (requireComplete && !profile?.routing?.envelope_profile) {
    add("routing.envelope_profile", "REQUIRED", "Routing envelope profile is required.");
  }

  return errors;
}

function mergeEditableProfile(existing, input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const base = existing && typeof existing === "object" ? existing : {};
  const merged = {
    ...base,
    ...source,
    identity: { ...(base.identity || {}), ...(source.identity || {}) },
    inbound: { ...(base.inbound || {}), ...(source.inbound || {}) },
    verification: {
      ...(base.verification || {}),
      ...(source.verification || {}),
      api_key: { ...(base.verification?.api_key || {}), ...(source.verification?.api_key || {}) },
      hmac_signature: {
        ...(base.verification?.hmac_signature || {}),
        ...(source.verification?.hmac_signature || {}),
      },
      oauth2_jwt: { ...(base.verification?.oauth2_jwt || {}), ...(source.verification?.oauth2_jwt || {}) },
    },
    idempotency: { ...(base.idempotency || {}), ...(source.idempotency || {}) },
    outbound: {
      ...(base.outbound || {}),
      ...(source.outbound || {}),
      auth: { ...(base.outbound?.auth || {}), ...(source.outbound?.auth || {}) },
      retry_policy: { ...(base.outbound?.retry_policy || {}), ...(source.outbound?.retry_policy || {}) },
    },
    routing: { ...(base.routing || {}), ...(source.routing || {}) },
    audit: { ...(base.audit || {}), ...(source.audit || {}) },
    attrs: { ...(base.attrs || {}), ...(source.attrs || {}) },
    health: base.health || {},
    credential_status: base.credential_status || {},
  };
  return normalizeProfile(merged, base);
}

function rowToProfile(row) {
  if (!row) return null;
  const value = row.setting_value && typeof row.setting_value === "object" ? row.setting_value : {};
  return {
    ...value,
    id: row.tenant_setting_id,
    setting_status: row.setting_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function summarizeProfile(profile) {
  return {
    id: profile.id,
    connection_code: profile.identity?.connection_code || null,
    connection_name: profile.identity?.connection_name || null,
    connection_kind: profile.identity?.connection_kind || null,
    direction: profile.identity?.direction || null,
    environment: profile.identity?.environment || null,
    is_enabled: profile.identity?.is_enabled === true,
    health_status: profile.health?.status || "unknown",
    last_successful_test_at: profile.health?.last_successful_test_at || null,
    setting_status: profile.setting_status || (profile.identity?.is_enabled === true ? "active" : "disabled"),
    updated_at: profile.updated_at || null,
  };
}

async function listConnectionProfiles(pool, tenantId) {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const result = await client.query(
      `
      SELECT tenant_setting_id, setting_key, setting_value, setting_status, created_at, updated_at
      FROM tenant.tenant_settings
      WHERE tenant_id = $1::uuid
        AND setting_key LIKE 'connection.profile.%'
        AND setting_status <> 'deprecated'
      ORDER BY lower(COALESCE(setting_value->'identity'->>'connection_name', setting_key)), setting_key
      `,
      [tenantId]
    );
    return result.rows.map(rowToProfile).map(summarizeProfile);
  });
}

async function getConnectionProfile(pool, tenantId, connectionCode) {
  const key = profileKey(connectionCode);
  return withTenantTransaction(pool, tenantId, async (client) => {
    const result = await client.query(
      `
      SELECT tenant_setting_id, setting_key, setting_value, setting_status, created_at, updated_at
      FROM tenant.tenant_settings
      WHERE tenant_id = $1::uuid
        AND setting_key = $2
      LIMIT 1
      `,
      [tenantId, key]
    );
    return rowToProfile(result.rows[0] || null);
  });
}

async function createConnectionProfile(pool, tenantId, input, taxonomy) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const identity = source.identity && typeof source.identity === "object" ? source.identity : {};
  const connectionName = text(identity.connection_name ?? source.connection_name);
  const initialProfile = normalizeProfile({
    ...source,
    identity: {
      ...identity,
      connection_code: buildConnectionCodeCandidate(connectionName, 1),
    },
  });

  if (initialProfile.identity.is_enabled === true) {
    throw new ConnectionProfileError(
      "New connections must be created as disabled drafts before activation.",
      "CONNECTION_ACTIVATION_REQUIRES_DRAFT",
      400,
      [
        {
          path: "identity.is_enabled",
          code: "ACTIVATION_REQUIRES_DRAFT",
          message: "Create the connection as a disabled draft, configure credentials and readiness, then enable it.",
        },
      ]
    );
  }

  const errors = validateConnectionProfile(initialProfile, taxonomy, { requireComplete: false });
  if (errors.length) {
    throw new ConnectionProfileError("Connection profile validation failed.", "CONNECTION_PROFILE_INVALID", 400, errors);
  }

  const settingStatus = "disabled";
  return withTenantTransaction(pool, tenantId, async (client) => {
    for (let serial = 1; serial <= MAX_CONNECTION_CODE_ALLOCATION_ATTEMPTS; serial += 1) {
      const candidateCode = buildConnectionCodeCandidate(connectionName, serial);
      const candidateProfile = serial === 1
        ? initialProfile
        : normalizeProfile({
            ...source,
            identity: {
              ...identity,
              connection_code: candidateCode,
              is_enabled: false,
            },
          });
      const key = profileKey(candidateCode);
      const result = await client.query(
        `
        INSERT INTO tenant.tenant_settings
          (tenant_setting_id, tenant_id, setting_key, setting_value, setting_status, created_at, updated_at)
        VALUES
          ($1::uuid, $2::uuid, $3, $4::jsonb, $5, now(), now())
        ON CONFLICT (tenant_id, setting_key) DO NOTHING
        RETURNING tenant_setting_id, setting_key, setting_value, setting_status, created_at, updated_at
        `,
        [crypto.randomUUID(), tenantId, key, JSON.stringify(candidateProfile), settingStatus]
      );
      if (result.rowCount === 1) return rowToProfile(result.rows[0]);
    }

    throw new ConnectionProfileError(
      "Unable to allocate a unique connection code for this tenant.",
      "CONNECTION_CODE_ALLOCATION_EXHAUSTED",
      409
    );
  });
}

async function updateConnectionProfile(pool, tenantId, connectionCode, input, taxonomy, options = {}) {
  const code = normalizeConnectionCode(connectionCode);
  const key = profileKey(code);

  return withTenantTransaction(pool, tenantId, async (client) => {
    const current = await client.query(
      `
      SELECT tenant_setting_id, setting_key, setting_value, setting_status, created_at, updated_at
      FROM tenant.tenant_settings
      WHERE tenant_id = $1::uuid
        AND setting_key = $2
      FOR UPDATE
      `,
      [tenantId, key]
    );
    if (current.rowCount !== 1) {
      throw new ConnectionProfileError("Connection profile was not found.", "CONNECTION_NOT_FOUND", 404);
    }

    const currentProfile = rowToProfile(current.rows[0]);
    const merged = mergeEditableProfile(currentProfile, input);
    if (merged.identity.connection_code !== code) {
      throw new ConnectionProfileError(
        "Connection code is immutable after creation.",
        "CONNECTION_CODE_IMMUTABLE",
        400
      );
    }
    const errors = validateConnectionProfile(merged, taxonomy, {
      requireComplete: merged.identity.is_enabled === true,
    });
    if (errors.length) {
      throw new ConnectionProfileError("Connection profile validation failed.", "CONNECTION_PROFILE_INVALID", 400, errors);
    }

    if (merged.identity.is_enabled === true) {
      if (typeof options.loadCredentialStatuses !== "function") {
        throw new ConnectionProfileError(
          "Connection activation readiness could not be verified.",
          "CONNECTION_ACTIVATION_CHECK_UNAVAILABLE",
          503
        );
      }
      const credentialStatuses = await options.loadCredentialStatuses(client, tenantId, code);
      const activationErrors = validateConnectionActivation(merged, credentialStatuses || {});
      if (activationErrors.length > 0) {
        throw new ConnectionProfileError(
          "Connection activation is blocked until all governed readiness requirements pass.",
          "CONNECTION_ACTIVATION_BLOCKED",
          409,
          activationErrors
        );
      }
    }

    const nextStatus = merged.identity.is_enabled === true ? "active" : "disabled";
    const result = await client.query(
      `
      UPDATE tenant.tenant_settings
      SET setting_value = $3::jsonb,
          setting_status = $4,
          updated_at = now()
      WHERE tenant_id = $1::uuid
        AND setting_key = $2
      RETURNING tenant_setting_id, setting_key, setting_value, setting_status, created_at, updated_at
      `,
      [tenantId, key, JSON.stringify(merged), nextStatus]
    );
    return rowToProfile(result.rows[0]);
  });
}

async function updateConnectionHealth(pool, tenantId, connectionCode, healthPatch) {
  const code = normalizeConnectionCode(connectionCode);
  const key = profileKey(code);
  const safeHealth = sanitizeJson(healthPatch) || {};

  return withTenantTransaction(pool, tenantId, async (client) => {
    const result = await client.query(
      `
      UPDATE tenant.tenant_settings
      SET setting_value = jsonb_set(
            setting_value,
            '{health}',
            COALESCE(setting_value->'health', '{}'::jsonb) || $3::jsonb,
            true
          ),
          updated_at = now()
      WHERE tenant_id = $1::uuid
        AND setting_key = $2
      RETURNING tenant_setting_id, setting_key, setting_value, setting_status, created_at, updated_at
      `,
      [tenantId, key, JSON.stringify(safeHealth)]
    );
    if (result.rowCount !== 1) {
      throw new ConnectionProfileError("Connection profile was not found.", "CONNECTION_NOT_FOUND", 404);
    }
    return rowToProfile(result.rows[0]);
  });
}

export {
  CONNECTION_CODE_PATTERN,
  PROFILE_KEY_PREFIX,
  ConnectionProfileError,
  buildConnectionCodeBase,
  buildConnectionCodeCandidate,
  createConnectionProfile,
  getConnectionProfile,
  listConnectionProfiles,
  mergeEditableProfile,
  normalizeConnectionCode,
  normalizeProfile,
  profileKey,
  sanitizeJson,
  summarizeProfile,
  updateConnectionHealth,
  updateConnectionProfile,
  validateConnectionProfile,
};
