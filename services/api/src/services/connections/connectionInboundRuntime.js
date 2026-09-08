import crypto from "node:crypto";
import { withTenantTransaction } from "../../db/tenantTransaction.js";
import { readSecret } from "./connectionSecretStore.js";

const TENANT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const INBOUND_SUFFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const HMAC_ALGORITHMS = new Set(["sha256", "sha512"]);
const HMAC_ENCODINGS = new Set(["hex", "base64", "base64url"]);
const HMAC_PAYLOAD_MODES = new Set(["raw", "timestamp_sha256"]);

class ConnectionInboundRuntimeError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "ConnectionInboundRuntimeError";
    this.code = code;
    this.status = status;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeTenantCode(value) {
  const code = text(value);
  if (!TENANT_CODE_PATTERN.test(code)) {
    throw new ConnectionInboundRuntimeError("Tenant route code is invalid.", "TENANT_ROUTE_INVALID", 404);
  }
  return code;
}

function normalizeInboundSuffix(value) {
  const suffix = text(value);
  if (!INBOUND_SUFFIX_PATTERN.test(suffix)) {
    throw new ConnectionInboundRuntimeError("Inbound route suffix is invalid.", "CONNECTION_ROUTE_INVALID", 404);
  }
  return suffix;
}

function headerValue(headers, name) {
  const key = text(name).toLowerCase();
  if (!key) return "";
  const value = headers?.[key];
  if (Array.isArray(value)) return text(value[0]);
  return text(value);
}

function timingSafeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""), "utf8");
  const rightBuffer = Buffer.from(String(right ?? ""), "utf8");
  if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function connectionAllowsOrigin(profile, origin) {
  const candidate = text(origin);
  if (!candidate) return true;
  const allowlist = Array.isArray(profile?.inbound?.origin_allowlist)
    ? profile.inbound.origin_allowlist.map(text).filter(Boolean)
    : [];
  if (allowlist.length === 0) return true;
  if (allowlist.includes(candidate)) return true;
  return profile?.identity?.environment !== "production" && allowlist.includes("*");
}

function connectionAllowsIp(profile, ip) {
  const candidate = text(ip);
  const allowlist = Array.isArray(profile?.audit?.ip_allowlist)
    ? profile.audit.ip_allowlist.map(text).filter(Boolean)
    : [];
  if (allowlist.length === 0) return true;
  return Boolean(candidate) && allowlist.includes(candidate);
}

function parseTimestampMs(value) {
  const raw = text(value);
  if (!raw) return NaN;
  if (/^\d{10,16}$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return NaN;
    return raw.length <= 10 ? numeric * 1000 : numeric;
  }
  return Date.parse(raw);
}

function stripSignaturePrefix(value, algorithm) {
  const raw = text(value);
  const prefix = `${algorithm}=`;
  return raw.toLowerCase().startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

function assertHmacConfig(profile) {
  const config = profile?.verification?.hmac_signature || {};
  const algorithm = text(config.algorithm).toLowerCase();
  const encoding = text(config.encoding).toLowerCase();
  const payloadMode = text(config.payload_mode).toLowerCase();
  if (!HMAC_ALGORITHMS.has(algorithm)) {
    throw new ConnectionInboundRuntimeError("Configured HMAC algorithm is not supported.", "CONNECTION_HMAC_ALGORITHM_UNSUPPORTED", 503);
  }
  if (!HMAC_ENCODINGS.has(encoding)) {
    throw new ConnectionInboundRuntimeError("Configured HMAC encoding is not supported.", "CONNECTION_HMAC_ENCODING_UNSUPPORTED", 503);
  }
  if (!HMAC_PAYLOAD_MODES.has(payloadMode)) {
    throw new ConnectionInboundRuntimeError("Configured HMAC payload mode is not supported.", "CONNECTION_HMAC_PAYLOAD_UNSUPPORTED", 503);
  }
  return { ...config, algorithm, encoding, payload_mode: payloadMode };
}

async function resolvePublicConnection(pool, tenantCode, suffix) {
  const safeTenantCode = normalizeTenantCode(tenantCode);
  const safeSuffix = normalizeInboundSuffix(suffix);

  const tenantResult = await pool.query(
    `
    SELECT tenant_id, tenant_code, tenant_status
    FROM kernel.tenants
    WHERE tenant_code = $1
      AND tenant_status = 'active'
    LIMIT 1
    `,
    [safeTenantCode]
  );
  if (tenantResult.rowCount !== 1) return null;
  const tenant = tenantResult.rows[0];

  const profile = await withTenantTransaction(pool, tenant.tenant_id, async (client) => {
    const result = await client.query(
      `
      SELECT tenant_setting_id, setting_key, setting_value, setting_status, created_at, updated_at
      FROM tenant.tenant_settings
      WHERE tenant_id = $1::uuid
        AND setting_key LIKE 'connection.profile.%'
        AND setting_status = 'active'
        AND setting_value->'identity'->>'is_enabled' = 'true'
        AND setting_value->'inbound'->>'inbound_path_suffix' = $2
      LIMIT 2
      `,
      [tenant.tenant_id, safeSuffix]
    );
    if (result.rowCount > 1) {
      throw new ConnectionInboundRuntimeError(
        "Inbound route is ambiguous inside this organisation.",
        "CONNECTION_ROUTE_AMBIGUOUS",
        409
      );
    }
    if (result.rowCount !== 1) return null;
    const row = result.rows[0];
    return {
      ...(row.setting_value && typeof row.setting_value === "object" ? row.setting_value : {}),
      id: row.tenant_setting_id,
      setting_status: row.setting_status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });

  if (!profile) return null;
  return { tenant, profile };
}

function assertInboundRequestAllowed(profile, request = {}) {
  const direction = text(profile?.identity?.direction).toLowerCase();
  if (!["inbound", "both"].includes(direction)) {
    throw new ConnectionInboundRuntimeError("Connection does not permit inbound traffic.", "INBOUND_NOT_ALLOWED", 403);
  }
  if (profile?.inbound?.webhook_enabled !== true) {
    throw new ConnectionInboundRuntimeError("Inbound transport is disabled.", "INBOUND_DISABLED", 403);
  }

  const expectedMethod = text(profile?.inbound?.http_method).toUpperCase();
  const actualMethod = text(request.method).toUpperCase();
  if (!expectedMethod || expectedMethod !== actualMethod) {
    throw new ConnectionInboundRuntimeError("Inbound HTTP method is not allowed.", "METHOD_NOT_ALLOWED", 405);
  }

  const expectedType = text(profile?.inbound?.expected_content_type).toLowerCase();
  const actualType = text(request.contentType).toLowerCase();
  if (expectedType && !actualType.includes(expectedType)) {
    throw new ConnectionInboundRuntimeError("Inbound content type is not allowed.", "UNSUPPORTED_CONTENT_TYPE", 415);
  }

  if (!connectionAllowsOrigin(profile, request.origin)) {
    throw new ConnectionInboundRuntimeError("Request origin is not allowed.", "ORIGIN_NOT_ALLOWED", 403);
  }
  if (!connectionAllowsIp(profile, request.ip)) {
    throw new ConnectionInboundRuntimeError("Request IP is not allowed.", "IP_NOT_ALLOWED", 403);
  }

  const configuredLimit = Number(profile?.audit?.max_body_size);
  const maxBodySize = Number.isFinite(configuredLimit)
    ? Math.max(1024, Math.min(configuredLimit, 5_242_880))
    : 1_048_576;
  const bodySize = Buffer.isBuffer(request.rawBody)
    ? request.rawBody.length
    : Buffer.byteLength(String(request.rawBody ?? ""));
  if (bodySize > maxBodySize) {
    throw new ConnectionInboundRuntimeError("Inbound payload exceeds the configured body limit.", "PAYLOAD_TOO_LARGE", 413);
  }
}

async function verifyInboundRequest({
  pool,
  tenantId,
  profile,
  headers,
  rawBody,
  config,
  now = Date.now(),
}) {
  const mode = text(profile?.verification?.mode).toLowerCase();
  const environment = text(profile?.identity?.environment).toLowerCase();

  if (mode === "none") {
    if (environment === "production" || profile?.verification?.allow_unverified !== true) {
      throw new ConnectionInboundRuntimeError("Unverified inbound traffic is not permitted.", "VERIFICATION_REQUIRED", 401);
    }
    return { verified: false, mode: "none", assurance: "sandbox_unverified" };
  }

  if (mode === "api_key") {
    const headerName = text(profile?.verification?.api_key?.header_name);
    const presented = headerValue(headers, headerName);
    if (!headerName || !presented) {
      throw new ConnectionInboundRuntimeError("API key is required.", "API_KEY_REQUIRED", 401);
    }
    const expected = await withTenantTransaction(pool, tenantId, (client) =>
      readSecret({
        client,
        tenantId,
        connectionCode: profile?.identity?.connection_code,
        secretKind: "api_key",
        config,
      })
    );
    if (!expected || !timingSafeTextEqual(presented, expected)) {
      throw new ConnectionInboundRuntimeError("API key verification failed.", "API_KEY_INVALID", 401);
    }
    return { verified: true, mode: "api_key", assurance: "shared_secret" };
  }

  if (mode === "hmac_signature") {
    const hmac = assertHmacConfig(profile);
    const signatureHeader = text(hmac.header_name);
    const presentedSignature = stripSignaturePrefix(headerValue(headers, signatureHeader), hmac.algorithm);
    if (!signatureHeader || !presentedSignature) {
      throw new ConnectionInboundRuntimeError("HMAC signature is required.", "HMAC_SIGNATURE_REQUIRED", 401);
    }
    const secret = await withTenantTransaction(pool, tenantId, (client) =>
      readSecret({
        client,
        tenantId,
        connectionCode: profile?.identity?.connection_code,
        secretKind: "hmac_secret",
        config,
      })
    );
    if (!secret) {
      throw new ConnectionInboundRuntimeError("HMAC credential is unavailable.", "HMAC_SECRET_UNAVAILABLE", 503);
    }

    let payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
    if (hmac.payload_mode === "timestamp_sha256") {
      const timestampHeader = text(hmac.timestamp_header);
      const timestamp = headerValue(headers, timestampHeader);
      const timestampMs = parseTimestampMs(timestamp);
      const maxSkewSeconds = Math.max(0, Math.min(Number(hmac.max_skew_sec) || 300, 3600));
      if (!timestampHeader || !Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > maxSkewSeconds * 1000) {
        throw new ConnectionInboundRuntimeError("HMAC timestamp is missing or outside the allowed skew.", "HMAC_TIMESTAMP_INVALID", 401);
      }
      const digest = crypto.createHash("sha256").update(payload).digest("hex");
      payload = Buffer.from(`${timestamp}\n${digest}`, "utf8");
    }

    const expected = crypto.createHmac(hmac.algorithm, secret).update(payload).digest(hmac.encoding);
    if (!timingSafeTextEqual(presentedSignature, expected)) {
      throw new ConnectionInboundRuntimeError("HMAC signature verification failed.", "HMAC_SIGNATURE_INVALID", 401);
    }
    return { verified: true, mode: "hmac_signature", assurance: "signed_payload" };
  }

  if (mode === "oauth2_jwt") {
    throw new ConnectionInboundRuntimeError(
      "OAuth2 JWT inbound verification is configured but the V2 JWKS verifier is not yet enabled.",
      "OAUTH2_JWT_RUNTIME_UNAVAILABLE",
      503
    );
  }

  throw new ConnectionInboundRuntimeError("Inbound verification mode is unsupported.", "VERIFICATION_MODE_UNSUPPORTED", 503);
}

export {
  ConnectionInboundRuntimeError,
  HMAC_ALGORITHMS,
  HMAC_ENCODINGS,
  HMAC_PAYLOAD_MODES,
  INBOUND_SUFFIX_PATTERN,
  TENANT_CODE_PATTERN,
  assertInboundRequestAllowed,
  connectionAllowsIp,
  connectionAllowsOrigin,
  headerValue,
  normalizeInboundSuffix,
  normalizeTenantCode,
  resolvePublicConnection,
  timingSafeTextEqual,
  verifyInboundRequest,
};
