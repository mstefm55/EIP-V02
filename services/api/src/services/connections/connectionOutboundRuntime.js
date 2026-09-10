import http from "node:http";
import https from "node:https";
import {
  OutboundHttpPolicyError,
  createPinnedLookup,
  resolveSafeOutboundUrl,
} from "../../security/outboundHttpPolicy.js";
import { getConnectionProfile } from "./connectionProfile.js";
import { readSecret } from "./connectionSecretStore.js";
import { withTenantTransaction } from "../../db/tenantTransaction.js";

const SUPPORTED_OUTBOUND_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
const SUPPORTED_BODY_ENCODINGS = new Set(["none", "json", "form", "text", "base64"]);
const SUPPORTED_RESPONSE_ENCODINGS = new Set(["auto", "json", "text", "base64"]);
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
const MAX_REQUEST_BODY_BYTES = 5_242_880;
const MAX_RESPONSE_BODY_BYTES = 5_242_880;
const DEFAULT_RESPONSE_BODY_BYTES = 1_048_576;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const BLOCKED_CALLER_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
]);
const BLOCKED_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "proxy-authenticate",
]);
const RESERVED_OAUTH_PARAMS = new Set([
  "client_secret",
  "access_token",
  "refresh_token",
  "password",
]);

class ConnectionOutboundRuntimeError extends Error {
  constructor(message, code, status = 400, details = {}) {
    super(message);
    this.name = "ConnectionOutboundRuntimeError";
    this.code = code;
    this.status = status;
    this.details = details && typeof details === "object" ? details : {};
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeMethod(value, fallback = "GET") {
  const method = text(value || fallback).toUpperCase();
  if (!SUPPORTED_OUTBOUND_METHODS.has(method)) {
    throw new ConnectionOutboundRuntimeError(
      "Outbound HTTP method is not supported.",
      "CONNECTION_OUTBOUND_METHOD_UNSUPPORTED",
      400
    );
  }
  return method;
}

function assertRelativeRequestPath(value, label = "request path") {
  const raw = text(value);
  if (!raw) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//") || raw.includes("\\") || raw.includes("\u0000")) {
    throw new ConnectionOutboundRuntimeError(
      `${label} must be relative to the configured base URL.`,
      "CONNECTION_OUTBOUND_PATH_INVALID",
      400
    );
  }
  const decoded = raw.toLowerCase().replace(/%2e/gi, ".");
  if (/(^|\/)\.\.?($|\/)/.test(decoded)) {
    throw new ConnectionOutboundRuntimeError(
      `${label} may not contain dot path traversal segments.`,
      "CONNECTION_OUTBOUND_PATH_TRAVERSAL",
      400
    );
  }
  return raw;
}

function appendPath(basePath, part) {
  const left = String(basePath || "/").replace(/\/+$/g, "");
  const right = String(part || "").replace(/^\/+|\/+$/g, "");
  if (!right) return left || "/";
  return `${left || ""}/${right}`.replace(/\/{2,}/g, "/") || "/";
}

function normalizeHeaderMap(value, options = {}) {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConnectionOutboundRuntimeError(
      "Outbound headers must be a JSON object.",
      "CONNECTION_OUTBOUND_HEADERS_INVALID",
      400
    );
  }
  const output = {};
  const entries = Object.entries(value).slice(0, 100);
  for (const [rawKey, rawValue] of entries) {
    const key = text(rawKey);
    const lower = key.toLowerCase();
    if (!HEADER_NAME_PATTERN.test(key)) {
      throw new ConnectionOutboundRuntimeError(
        "Outbound request contains an invalid HTTP header name.",
        "CONNECTION_OUTBOUND_HEADER_NAME_INVALID",
        400
      );
    }
    if (!options.allowSensitive && BLOCKED_CALLER_HEADERS.has(lower)) {
      throw new ConnectionOutboundRuntimeError(
        "Authentication and transport-controlled headers cannot be supplied by the caller.",
        "CONNECTION_OUTBOUND_HEADER_FORBIDDEN",
        400,
        { header: lower }
      );
    }
    const headerValue = Array.isArray(rawValue)
      ? rawValue.map((entry) => String(entry ?? "")).join(", ")
      : String(rawValue ?? "");
    if (headerValue.length > 8192 || /[\r\n]/.test(headerValue)) {
      throw new ConnectionOutboundRuntimeError(
        "Outbound request contains an invalid HTTP header value.",
        "CONNECTION_OUTBOUND_HEADER_VALUE_INVALID",
        400
      );
    }
    output[key] = headerValue;
  }
  return output;
}

function normalizeQuery(value) {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConnectionOutboundRuntimeError(
      "Outbound query parameters must be a JSON object.",
      "CONNECTION_OUTBOUND_QUERY_INVALID",
      400
    );
  }
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 100)) {
    const key = text(rawKey);
    if (!key || key.length > 200) {
      throw new ConnectionOutboundRuntimeError(
        "Outbound query contains an invalid parameter name.",
        "CONNECTION_OUTBOUND_QUERY_KEY_INVALID",
        400
      );
    }
    const values = Array.isArray(rawValue) ? rawValue.slice(0, 100) : [rawValue];
    output[key] = values
      .filter((entry) => entry !== null && entry !== undefined)
      .map((entry) => {
        if (!["string", "number", "boolean", "bigint"].includes(typeof entry)) {
          throw new ConnectionOutboundRuntimeError(
            "Outbound query values must be scalar values or arrays of scalar values.",
            "CONNECTION_OUTBOUND_QUERY_VALUE_INVALID",
            400
          );
        }
        const normalized = String(entry);
        if (normalized.length > 4096) {
          throw new ConnectionOutboundRuntimeError(
            "Outbound query value exceeds the bounded size limit.",
            "CONNECTION_OUTBOUND_QUERY_VALUE_TOO_LARGE",
            400
          );
        }
        return normalized;
      });
  }
  return output;
}

function appendQuery(url, query) {
  const parsed = url instanceof URL ? url : new URL(url);
  for (const [key, values] of Object.entries(query || {})) {
    parsed.searchParams.delete(key);
    for (const value of values) parsed.searchParams.append(key, value);
  }
  return parsed;
}

function normalizeFormObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConnectionOutboundRuntimeError(
      "Form-encoded request bodies must be JSON objects.",
      "CONNECTION_OUTBOUND_FORM_BODY_INVALID",
      400
    );
  }
  const params = new URLSearchParams();
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 200)) {
    const key = text(rawKey);
    if (!key || key.length > 200) continue;
    const values = Array.isArray(rawValue) ? rawValue.slice(0, 100) : [rawValue];
    for (const entry of values) {
      if (entry === null || entry === undefined) continue;
      if (!["string", "number", "boolean", "bigint"].includes(typeof entry)) {
        throw new ConnectionOutboundRuntimeError(
          "Form-encoded request values must be scalar values or arrays of scalar values.",
          "CONNECTION_OUTBOUND_FORM_VALUE_INVALID",
          400
        );
      }
      params.append(key, String(entry));
    }
  }
  return params.toString();
}

function defaultContentTypeForEncoding(encoding) {
  if (encoding === "json") return "application/json";
  if (encoding === "form") return "application/x-www-form-urlencoded";
  if (encoding === "text") return "text/plain; charset=utf-8";
  if (encoding === "base64") return "application/octet-stream";
  return "";
}

function normalizeBodyEncoding(value, fallback = "none") {
  const encoding = text(value || fallback).toLowerCase() || "none";
  if (!SUPPORTED_BODY_ENCODINGS.has(encoding)) {
    throw new ConnectionOutboundRuntimeError(
      "Outbound body encoding is not supported.",
      "CONNECTION_OUTBOUND_BODY_ENCODING_UNSUPPORTED",
      400
    );
  }
  return encoding;
}

function normalizeResponseEncoding(value, fallback = "auto") {
  const encoding = text(value || fallback).toLowerCase() || "auto";
  if (!SUPPORTED_RESPONSE_ENCODINGS.has(encoding)) {
    throw new ConnectionOutboundRuntimeError(
      "Outbound response encoding is not supported.",
      "CONNECTION_OUTBOUND_RESPONSE_ENCODING_UNSUPPORTED",
      400
    );
  }
  return encoding;
}

function serializeRequestBody(body, encoding, maxBytes) {
  if (body === undefined || body === null || encoding === "none") return null;
  let buffer;
  if (encoding === "json") {
    try {
      buffer = Buffer.from(JSON.stringify(body), "utf8");
    } catch {
      throw new ConnectionOutboundRuntimeError(
        "Outbound JSON body could not be serialized.",
        "CONNECTION_OUTBOUND_JSON_BODY_INVALID",
        400
      );
    }
  } else if (encoding === "form") {
    buffer = Buffer.from(normalizeFormObject(body), "utf8");
  } else if (encoding === "text") {
    buffer = Buffer.from(String(body), "utf8");
  } else if (encoding === "base64") {
    if (typeof body !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.replace(/\s+/g, ""))) {
      throw new ConnectionOutboundRuntimeError(
        "Base64 request body is invalid.",
        "CONNECTION_OUTBOUND_BASE64_BODY_INVALID",
        400
      );
    }
    buffer = Buffer.from(body.replace(/\s+/g, ""), "base64");
  }

  if (!buffer || buffer.length > maxBytes) {
    throw new ConnectionOutboundRuntimeError(
      "Outbound request body exceeds the configured size limit.",
      "CONNECTION_OUTBOUND_BODY_TOO_LARGE",
      413
    );
  }
  return buffer;
}

function buildOutboundRequestUrl(profile, request = {}) {
  const baseUrl = text(profile?.outbound?.base_url);
  if (!baseUrl) {
    throw new ConnectionOutboundRuntimeError(
      "Outbound base URL is not configured.",
      "CONNECTION_OUTBOUND_URL_REQUIRED",
      400
    );
  }
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ConnectionOutboundRuntimeError(
      "Outbound base URL is invalid.",
      "CONNECTION_OUTBOUND_URL_INVALID",
      400
    );
  }
  parsed.hash = "";
  const pathPrefix = assertRelativeRequestPath(profile?.outbound?.path_prefix || "", "path prefix");
  const requestPath = assertRelativeRequestPath(request.path || "", "request path");
  parsed.pathname = appendPath(appendPath(parsed.pathname, pathPrefix), requestPath);
  return appendQuery(parsed, normalizeQuery(request.query));
}

function buildConnectionRequestPlan(profile, request = {}) {
  const direction = text(profile?.identity?.direction).toLowerCase();
  if (!["outbound", "both"].includes(direction)) {
    throw new ConnectionOutboundRuntimeError(
      "Connection does not permit outbound traffic.",
      "CONNECTION_OUTBOUND_NOT_ALLOWED",
      403
    );
  }

  const method = normalizeMethod(request.method || "GET");
  const profileRequest = profile?.outbound?.request && typeof profile.outbound.request === "object"
    ? profile.outbound.request
    : {};
  const encodingFallback = request.body === undefined || request.body === null
    ? "none"
    : (profileRequest.body_encoding || (typeof request.body === "object" ? "json" : "text"));
  const bodyEncoding = normalizeBodyEncoding(request.body_encoding, encodingFallback);
  if (["GET", "HEAD"].includes(method) && request.body !== undefined && request.body !== null) {
    throw new ConnectionOutboundRuntimeError(
      "GET and HEAD connection requests cannot carry a request body.",
      "CONNECTION_OUTBOUND_BODY_METHOD_FORBIDDEN",
      400
    );
  }

  const maxRequestBytes = boundedInteger(
    profileRequest.max_body_bytes ?? profile?.audit?.max_body_size,
    1_048_576,
    1024,
    MAX_REQUEST_BODY_BYTES
  );
  const maxResponseBytes = boundedInteger(
    profileRequest.max_response_bytes,
    DEFAULT_RESPONSE_BODY_BYTES,
    1024,
    MAX_RESPONSE_BODY_BYTES
  );
  const body = serializeRequestBody(request.body, bodyEncoding, maxRequestBytes);
  const defaultHeaders = normalizeHeaderMap(profile?.outbound?.default_headers || {});
  const callerHeaders = normalizeHeaderMap(request.headers || {});
  const headers = { ...defaultHeaders, ...callerHeaders };
  const contentType = text(request.content_type || profileRequest.content_type || defaultContentTypeForEncoding(bodyEncoding));
  const accept = text(request.accept || profileRequest.accept || "application/json, text/plain, */*");
  if (contentType && body) headers["Content-Type"] = contentType;
  if (accept) headers.Accept = accept;
  if (body) headers["Content-Length"] = String(body.length);

  const idempotencyKey = text(request.idempotency_key);
  if (idempotencyKey) {
    if (idempotencyKey.length > 255 || /[\r\n]/.test(idempotencyKey)) {
      throw new ConnectionOutboundRuntimeError(
        "Idempotency key is invalid.",
        "CONNECTION_OUTBOUND_IDEMPOTENCY_KEY_INVALID",
        400
      );
    }
    const headerName = text(profileRequest.idempotency_header_name || "Idempotency-Key");
    if (!HEADER_NAME_PATTERN.test(headerName) || BLOCKED_CALLER_HEADERS.has(headerName.toLowerCase())) {
      throw new ConnectionOutboundRuntimeError(
        "Configured idempotency header name is invalid.",
        "CONNECTION_OUTBOUND_IDEMPOTENCY_HEADER_INVALID",
        500
      );
    }
    headers[headerName] = idempotencyKey;
  }

  const timeoutMs = boundedInteger(profile?.outbound?.timeout_ms, 8000, 250, 30_000);
  const maxRetries = boundedInteger(profile?.outbound?.retry_policy?.max_retries, 0, 0, 5);
  const backoffMs = boundedInteger(profile?.outbound?.retry_policy?.backoff_ms, 250, 50, 30_000);
  const responseEncoding = normalizeResponseEncoding(request.response_encoding, profileRequest.response_encoding || "auto");

  return {
    method,
    url: buildOutboundRequestUrl(profile, request),
    headers,
    body,
    body_encoding: bodyEncoding,
    content_type: contentType || null,
    response_encoding: responseEncoding,
    timeout_ms: timeoutMs,
    max_response_bytes: maxResponseBytes,
    max_retries: maxRetries,
    backoff_ms: backoffMs,
    idempotency_key_present: Boolean(idempotencyKey),
    auth_mode: text(profile?.outbound?.auth_mode).toLowerCase() || "none",
  };
}

function sanitizeResponseHeaders(headers = {}) {
  const output = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = String(key).toLowerCase();
    if (BLOCKED_RESPONSE_HEADERS.has(lower)) continue;
    if (value === undefined || value === null) continue;
    const normalized = Array.isArray(value) ? value.map(String).join(", ") : String(value);
    output[lower] = normalized.slice(0, 8192);
  }
  return output;
}

function decodeResponseBody(buffer, contentType, responseEncoding) {
  const encoding = normalizeResponseEncoding(responseEncoding, "auto");
  if (!buffer || buffer.length === 0) return null;
  if (encoding === "base64") return buffer.toString("base64");
  const rawText = buffer.toString("utf8");
  if (encoding === "text") return rawText;
  if (encoding === "json" || (encoding === "auto" && /(^|[+\/])json(?:;|$)/i.test(String(contentType || "")))) {
    try {
      return JSON.parse(rawText);
    } catch {
      if (encoding === "json") {
        throw new ConnectionOutboundRuntimeError(
          "Outbound response declared JSON but could not be parsed.",
          "CONNECTION_OUTBOUND_RESPONSE_JSON_INVALID",
          502
        );
      }
    }
  }
  return rawText;
}

async function performSafeHttpRequest(options = {}) {
  const method = normalizeMethod(options.method || "GET");
  const resolved = await resolveSafeOutboundUrl(options.url, {
    ...(options.lookupFn ? { lookupFn: options.lookupFn } : {}),
  });
  const timeoutMs = boundedInteger(options.timeoutMs, 8000, 250, 30_000);
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes,
    DEFAULT_RESPONSE_BODY_BYTES,
    1024,
    MAX_RESPONSE_BODY_BYTES
  );
  const requestFn = resolved.url.protocol === "https:" ? https.request : http.request;
  const body = Buffer.isBuffer(options.body) ? options.body : options.body ? Buffer.from(options.body) : null;
  const headers = normalizeHeaderMap(options.headers || {}, { allowSensitive: true });
  const started = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (error instanceof ConnectionOutboundRuntimeError || error instanceof OutboundHttpPolicyError) {
        reject(error);
        return;
      }
      reject(new ConnectionOutboundRuntimeError(
        "Outbound connection request failed.",
        "CONNECTION_OUTBOUND_REQUEST_FAILED",
        502
      ));
    };

    const request = requestFn(resolved.url, {
      method,
      lookup: createPinnedLookup(resolved.addresses),
      headers,
    }, (response) => {
      const chunks = [];
      let received = 0;
      response.on("data", (chunk) => {
        if (settled) return;
        received += Buffer.byteLength(chunk);
        if (received > maxResponseBytes) {
          request.destroy();
          fail(new ConnectionOutboundRuntimeError(
            "Outbound response exceeded the configured size limit.",
            "CONNECTION_OUTBOUND_RESPONSE_TOO_LARGE",
            502
          ));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          status_code: Number(response.statusCode) || 0,
          headers: sanitizeResponseHeaders(response.headers || {}),
          body_buffer: Buffer.concat(chunks),
          latency_ms: Math.max(0, Date.now() - started),
          resolved_family: resolved.addresses[0]?.family || null,
          redirect_location:
            Number(response.statusCode) >= 300 && Number(response.statusCode) < 400
              ? text(response.headers?.location) || null
              : null,
        });
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      fail(new ConnectionOutboundRuntimeError(
        "Outbound connection request timed out.",
        "CONNECTION_OUTBOUND_REQUEST_TIMEOUT",
        504
      ));
    });
    request.on("error", fail);
    if (body) request.write(body);
    request.end();
  });
}

async function readCredential({ pool, tenantId, connectionCode, secretKind, config }) {
  const value = await withTenantTransaction(pool, tenantId, (client) =>
    readSecret({
      client,
      tenantId,
      connectionCode,
      secretKind,
      config,
    })
  );
  if (!value) {
    throw new ConnectionOutboundRuntimeError(
      "Required outbound credential is not configured.",
      "CONNECTION_OUTBOUND_CREDENTIAL_REQUIRED",
      503,
      { secret_kind: secretKind }
    );
  }
  return value;
}

function normalizeOAuthTokenParams(value) {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConnectionOutboundRuntimeError(
      "OAuth token parameters must be a JSON object.",
      "CONNECTION_OAUTH_TOKEN_PARAMS_INVALID",
      500
    );
  }
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 100)) {
    const key = text(rawKey);
    if (!key || RESERVED_OAUTH_PARAMS.has(key.toLowerCase())) continue;
    if (!["string", "number", "boolean", "bigint"].includes(typeof rawValue)) {
      throw new ConnectionOutboundRuntimeError(
        "OAuth token parameters must contain scalar values.",
        "CONNECTION_OAUTH_TOKEN_PARAM_VALUE_INVALID",
        500
      );
    }
    output[key] = String(rawValue);
  }
  return output;
}

async function resolveOAuthAccessToken({
  pool,
  tenantId,
  connectionCode,
  profile,
  config,
  transport = performSafeHttpRequest,
}) {
  const auth = profile?.outbound?.auth || {};
  const clientId = text(auth.client_id);
  const tokenUrl = text(auth.token_url);
  if (!clientId || !tokenUrl) {
    throw new ConnectionOutboundRuntimeError(
      "OAuth client ID and token URL are required.",
      "CONNECTION_OAUTH_CONFIG_REQUIRED",
      503
    );
  }
  const clientSecret = await readCredential({
    pool,
    tenantId,
    connectionCode,
    secretKind: "oauth_client_secret",
    config,
  });

  const clientAuthMethod = text(auth.client_auth_method || "basic").toLowerCase();
  if (!["basic", "body", "client_secret_basic", "client_secret_post"].includes(clientAuthMethod)) {
    throw new ConnectionOutboundRuntimeError(
      "OAuth client authentication method is unsupported.",
      "CONNECTION_OAUTH_CLIENT_AUTH_UNSUPPORTED",
      503
    );
  }

  const tokenBodyEncoding = normalizeBodyEncoding(auth.token_body_encoding, "form");
  if (!["form", "json"].includes(tokenBodyEncoding)) {
    throw new ConnectionOutboundRuntimeError(
      "OAuth token request must use form or JSON encoding.",
      "CONNECTION_OAUTH_TOKEN_BODY_ENCODING_UNSUPPORTED",
      503
    );
  }
  const tokenParams = {
    grant_type: "client_credentials",
    ...normalizeOAuthTokenParams(auth.token_params || {}),
  };
  if (text(auth.scope)) tokenParams.scope = text(auth.scope);

  const headers = {
    Accept: "application/json",
    ...normalizeHeaderMap(auth.token_headers || {}),
  };
  if (["basic", "client_secret_basic"].includes(clientAuthMethod)) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
  } else {
    tokenParams.client_id = clientId;
    tokenParams.client_secret = clientSecret;
  }

  const body = serializeRequestBody(tokenParams, tokenBodyEncoding, MAX_REQUEST_BODY_BYTES);
  headers["Content-Type"] = defaultContentTypeForEncoding(tokenBodyEncoding);
  headers["Content-Length"] = String(body?.length || 0);

  const response = await transport({
    url: tokenUrl,
    method: "POST",
    headers,
    body,
    timeoutMs: boundedInteger(profile?.outbound?.timeout_ms, 8000, 250, 30_000),
    maxResponseBytes: 262_144,
  });
  if (response.status_code < 200 || response.status_code >= 300) {
    throw new ConnectionOutboundRuntimeError(
      "OAuth token endpoint rejected the credential exchange.",
      "CONNECTION_OAUTH_TOKEN_EXCHANGE_FAILED",
      502,
      { status_code: response.status_code }
    );
  }
  let payload;
  try {
    payload = JSON.parse(response.body_buffer.toString("utf8"));
  } catch {
    throw new ConnectionOutboundRuntimeError(
      "OAuth token endpoint returned an invalid JSON response.",
      "CONNECTION_OAUTH_TOKEN_RESPONSE_INVALID",
      502
    );
  }
  const accessToken = text(payload?.access_token);
  if (!accessToken) {
    throw new ConnectionOutboundRuntimeError(
      "OAuth token response did not contain an access token.",
      "CONNECTION_OAUTH_ACCESS_TOKEN_MISSING",
      502
    );
  }
  return {
    access_token: accessToken,
    token_type: text(payload?.token_type || "Bearer") || "Bearer",
    expires_in: Number(payload?.expires_in) || null,
  };
}

async function applyOutboundAuthentication({
  pool,
  tenantId,
  connectionCode,
  profile,
  plan,
  config,
  transport = performSafeHttpRequest,
}) {
  const mode = plan.auth_mode;
  const auth = profile?.outbound?.auth || {};
  const headers = { ...plan.headers };
  const url = new URL(plan.url.toString());

  if (!mode || mode === "none") return { ...plan, headers, url };

  if (mode === "bearer") {
    const token = await readCredential({ pool, tenantId, connectionCode, secretKind: "bearer_token", config });
    headers.Authorization = `Bearer ${token}`;
    return { ...plan, headers, url };
  }

  if (mode === "api_key_header") {
    const headerName = text(auth.header_name);
    if (!HEADER_NAME_PATTERN.test(headerName)) {
      throw new ConnectionOutboundRuntimeError(
        "Outbound API key header name is invalid.",
        "CONNECTION_OUTBOUND_API_KEY_HEADER_INVALID",
        503
      );
    }
    const apiKey = await readCredential({ pool, tenantId, connectionCode, secretKind: "api_key", config });
    headers[headerName] = apiKey;
    return { ...plan, headers, url };
  }

  if (mode === "api_key_query") {
    const parameterName = text(auth.query_param_name);
    if (!parameterName || parameterName.length > 200) {
      throw new ConnectionOutboundRuntimeError(
        "Outbound API key query parameter is invalid.",
        "CONNECTION_OUTBOUND_API_KEY_QUERY_INVALID",
        503
      );
    }
    const apiKey = await readCredential({ pool, tenantId, connectionCode, secretKind: "api_key", config });
    url.searchParams.set(parameterName, apiKey);
    return { ...plan, headers, url };
  }

  if (mode === "basic") {
    const username = text(auth.username);
    if (!username) {
      throw new ConnectionOutboundRuntimeError(
        "Basic authentication username is not configured.",
        "CONNECTION_OUTBOUND_BASIC_USERNAME_REQUIRED",
        503
      );
    }
    const password = await readCredential({ pool, tenantId, connectionCode, secretKind: "basic_password", config });
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
    return { ...plan, headers, url };
  }

  if (mode === "oauth2_client_credentials") {
    const token = await resolveOAuthAccessToken({
      pool,
      tenantId,
      connectionCode,
      profile,
      config,
      transport,
    });
    const headerName = text(auth.token_header_name || "Authorization") || "Authorization";
    if (!HEADER_NAME_PATTERN.test(headerName)) {
      throw new ConnectionOutboundRuntimeError(
        "OAuth access-token header name is invalid.",
        "CONNECTION_OAUTH_TOKEN_HEADER_INVALID",
        503
      );
    }
    const prefix = text(auth.token_prefix || token.token_type || "Bearer") || "Bearer";
    headers[headerName] = `${prefix} ${token.access_token}`;
    return { ...plan, headers, url };
  }

  throw new ConnectionOutboundRuntimeError(
    "Configured outbound authentication mode is not implemented.",
    "CONNECTION_OUTBOUND_AUTH_MODE_UNSUPPORTED",
    503
  );
}

function shouldRetry(plan, responseOrError, attempt) {
  if (attempt >= plan.max_retries) return false;
  if (!IDEMPOTENT_METHODS.has(plan.method) && !plan.idempotency_key_present) return false;
  if (responseOrError instanceof Error) {
    return [502, 503, 504].includes(Number(responseOrError.status));
  }
  return RETRYABLE_STATUS_CODES.has(Number(responseOrError?.status_code));
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publicRequestPlan(profile, plan) {
  const authMode = text(profile?.outbound?.auth_mode).toLowerCase() || "none";
  const credentialKind = authMode === "bearer"
    ? "bearer_token"
    : ["api_key_header", "api_key_query"].includes(authMode)
      ? "api_key"
      : authMode === "basic"
        ? "basic_password"
        : authMode === "oauth2_client_credentials"
          ? "oauth_client_secret"
          : null;
  const safeHeaders = {};
  for (const [key, value] of Object.entries(plan.headers || {})) {
    if (BLOCKED_CALLER_HEADERS.has(key.toLowerCase())) continue;
    safeHeaders[key] = value;
  }
  return {
    method: plan.method,
    url: plan.url.toString(),
    headers: safeHeaders,
    body_encoding: plan.body_encoding,
    body_bytes: plan.body?.length || 0,
    content_type: plan.content_type,
    response_encoding: plan.response_encoding,
    timeout_ms: plan.timeout_ms,
    max_response_bytes: plan.max_response_bytes,
    max_retries: plan.max_retries,
    backoff_ms: plan.backoff_ms,
    idempotency_key_present: plan.idempotency_key_present,
    authentication: {
      mode: authMode,
      credential_kind_required: credentialKind,
      credential_value_exposed: false,
      ...(authMode === "oauth2_client_credentials"
        ? { token_url: text(profile?.outbound?.auth?.token_url) || null }
        : {}),
    },
  };
}

async function planConnectionRequest({
  pool,
  tenantId,
  connectionCode,
  request = {},
}) {
  const profile = await getConnectionProfile(pool, tenantId, connectionCode);
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

async function executeConnectionRequest({
  pool,
  tenantId,
  connectionCode,
  request = {},
  config = {},
  requireEnabled = true,
  services = {},
}) {
  const profile = await (services.getConnectionProfile || getConnectionProfile)(pool, tenantId, connectionCode);
  if (!profile || profile.setting_status === "deprecated") {
    throw new ConnectionOutboundRuntimeError(
      "Connection profile was not found.",
      "CONNECTION_NOT_FOUND",
      404
    );
  }
  if (requireEnabled && profile?.identity?.is_enabled !== true) {
    throw new ConnectionOutboundRuntimeError(
      "Connection is disabled.",
      "CONNECTION_OUTBOUND_DISABLED",
      409
    );
  }

  const transport = services.performSafeHttpRequest || performSafeHttpRequest;
  const sleep = services.sleep || defaultSleep;
  const basePlan = buildConnectionRequestPlan(profile, request);
  const plan = await applyOutboundAuthentication({
    pool,
    tenantId,
    connectionCode: profile?.identity?.connection_code || connectionCode,
    profile,
    plan: basePlan,
    config,
    transport,
  });

  let attempt = 0;
  while (true) {
    try {
      const response = await transport({
        url: plan.url,
        method: plan.method,
        headers: plan.headers,
        body: plan.body,
        timeoutMs: plan.timeout_ms,
        maxResponseBytes: plan.max_response_bytes,
      });
      if (shouldRetry(plan, response, attempt)) {
        attempt += 1;
        await sleep(Math.min(plan.backoff_ms * (2 ** (attempt - 1)), 30_000));
        continue;
      }
      const contentType = response.headers?.["content-type"] || "";
      return {
        ok: response.status_code >= 200 && response.status_code < 300,
        connection_code: profile?.identity?.connection_code || connectionCode,
        status_code: response.status_code,
        headers: response.headers,
        body: decodeResponseBody(response.body_buffer, contentType, plan.response_encoding),
        body_encoding: plan.response_encoding,
        latency_ms: response.latency_ms,
        attempts: attempt + 1,
        redirect_location: response.redirect_location,
      };
    } catch (error) {
      if (shouldRetry(plan, error, attempt)) {
        attempt += 1;
        await sleep(Math.min(plan.backoff_ms * (2 ** (attempt - 1)), 30_000));
        continue;
      }
      throw error;
    }
  }
}

export {
  BLOCKED_CALLER_HEADERS,
  ConnectionOutboundRuntimeError,
  IDEMPOTENT_METHODS,
  MAX_REQUEST_BODY_BYTES,
  MAX_RESPONSE_BODY_BYTES,
  RETRYABLE_STATUS_CODES,
  SUPPORTED_BODY_ENCODINGS,
  SUPPORTED_OUTBOUND_METHODS,
  SUPPORTED_RESPONSE_ENCODINGS,
  appendQuery,
  applyOutboundAuthentication,
  assertRelativeRequestPath,
  buildConnectionRequestPlan,
  buildOutboundRequestUrl,
  decodeResponseBody,
  executeConnectionRequest,
  normalizeHeaderMap,
  normalizeMethod,
  normalizeQuery,
  performSafeHttpRequest,
  planConnectionRequest,
  publicRequestPlan,
  resolveOAuthAccessToken,
  serializeRequestBody,
  shouldRetry,
};
