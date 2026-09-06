import { normalizeInternalApiPath } from "./apiEndpointSecurity.js";

// Production auth/session transport is same-origin through the workbench runtime proxy.
// Direct cross-origin API URLs remain available for local development only.
const BASE_URL = import.meta.env?.DEV ? (import.meta.env?.VITE_API_BASE_URL || "") : "";
const CSRF_ENDPOINT = "/api/eip/auth/csrf";
const CSRF_ERROR_CODES = new Set(["CSRF_MISSING", "CSRF_MISMATCH", "CSRF_INVALID"]);
const SESSION_MUTATING_PATHS = new Set([
  "/api/eip/auth/login/password",
  "/api/eip/auth/login/otp",
  "/api/eip/auth/login/totp",
  "/api/eip/auth/logout",
]);

let cachedCsrfToken = null;
let csrfTokenPromise = null;

class ApiError extends Error {
  constructor(status, payload, rawBody) {
    const fallback = payload?.error || rawBody || `HTTP_${status}`;
    super(`API ${status}: ${fallback}`);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload || null;
    this.rawBody = rawBody || "";
  }
}

function readCookie(name) {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(document.cookie || "").match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function readLocalCsrfCookie() {
  return readCookie("csrf") || readCookie("__Host-csrf") || null;
}

function buildUrl(path) {
  const approvedPath = normalizeInternalApiPath(path);
  return `${BASE_URL}${approvedPath}`;
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return { payload: null, rawBody: "" };
  try {
    return {
      payload: JSON.parse(text),
      rawBody: text,
    };
  } catch {
    return {
      payload: null,
      rawBody: text,
    };
  }
}

function normalizeMethod(method) {
  return String(method || "GET").trim().toUpperCase();
}

function isFormDataBody(body) {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function buildRequestBody(body) {
  if (body === undefined) return undefined;
  return isFormDataBody(body) ? body : JSON.stringify(body);
}

function shouldSendCsrf(method) {
  return method !== "GET" && method !== "HEAD";
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });
  return query.toString();
}

function buildPath(path, query) {
  const qs = buildQuery(query);
  if (!qs) return path;
  return path.includes("?") ? `${path}&${qs}` : `${path}?${qs}`;
}

function extractCsrfToken(payload) {
  const token = payload?.csrf || payload?.csrf_token || payload?.csrfToken || null;
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

function resetCsrfToken() {
  cachedCsrfToken = null;
  csrfTokenPromise = null;
}

async function getCsrfToken({ refresh = false } = {}) {
  if (refresh) {
    resetCsrfToken();
  } else {
    if (cachedCsrfToken) return cachedCsrfToken;
    const localCookie = readLocalCsrfCookie();
    if (localCookie) {
      cachedCsrfToken = localCookie;
      return localCookie;
    }
    if (csrfTokenPromise) return csrfTokenPromise;
  }

  csrfTokenPromise = (async () => {
    try {
      const response = await fetch(buildUrl(CSRF_ENDPOINT), {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        return readLocalCsrfCookie();
      }
      const { payload } = await parseBody(response);
      const token = extractCsrfToken(payload) || readLocalCsrfCookie();
      if (token) cachedCsrfToken = token;
      return token || null;
    } catch {
      return readLocalCsrfCookie();
    } finally {
      csrfTokenPromise = null;
    }
  })();

  return csrfTokenPromise;
}

function shouldResetCsrfAfterSuccess(path, method) {
  if (method === "GET" || method === "HEAD") return false;
  return SESSION_MUTATING_PATHS.has(String(path || "").split("?")[0]);
}

async function performRequest(path, options, { refreshCsrf = false } = {}) {
  const url = buildUrl(path);
  const method = normalizeMethod(options.method);
  const headers = {
    ...(options.headers || {}),
  };
  const hasBody = options.body !== undefined;
  const isFormData = isFormDataBody(options.body);

  if (hasBody && !isFormData && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (shouldSendCsrf(method)) {
    const csrf = await getCsrfToken({ refresh: refreshCsrf });
    if (csrf) headers["x-csrf"] = csrf;
  }

  return fetch(url, {
    method,
    headers,
    credentials: "include",
    body: hasBody ? buildRequestBody(options.body) : undefined,
    signal: options.signal,
    cache: options.cache,
  });
}

async function apiFetchWithMeta(path, options = {}) {
  const method = normalizeMethod(options.method);
  let response = await performRequest(path, options);

  if (response.status === 304) {
    return { status: 304, headers: response.headers, data: null };
  }

  let parsed = await parseBody(response);
  if (!response.ok && CSRF_ERROR_CODES.has(parsed.payload?.error)) {
    response = await performRequest(path, options, { refreshCsrf: true });
    if (response.status === 304) {
      return { status: 304, headers: response.headers, data: null };
    }
    parsed = await parseBody(response);
  }

  if (!response.ok) {
    if (response.status === 401) resetCsrfToken();
    throw new ApiError(response.status, parsed.payload, parsed.rawBody);
  }

  const payloadToken = extractCsrfToken(parsed.payload);
  if (payloadToken) {
    cachedCsrfToken = payloadToken;
  } else if (shouldResetCsrfAfterSuccess(path, method)) {
    resetCsrfToken();
  }

  return {
    status: response.status,
    headers: response.headers,
    data: parsed.payload,
  };
}

async function apiFetch(path, options = {}) {
  const { data } = await apiFetchWithMeta(path, options);
  return data;
}

function describeApiError(error, fallback = "Request failed.") {
  if (!(error instanceof ApiError)) {
    return error?.message || fallback;
  }

  const code = error.payload?.error;
  if (code === "UNAUTHENTICATED") return "Session expired. Please sign in again.";
  if (code === "STEP_UP_REQUIRED") return "Additional verification is required. Use OTP or TOTP to continue.";
  if (code === "ORIGIN_FORBIDDEN") return "This sign-in origin is not allowed.";
  if (code === "CSRF_MISSING" || code === "CSRF_MISMATCH" || code === "CSRF_INVALID") {
    return "Security verification expired. Please retry the action.";
  }
  if (code === "PERMISSION_REQUIRED") {
    const required = Array.isArray(error.payload?.required_permissions)
      ? error.payload.required_permissions.join(", ")
      : null;
    return required
      ? `Permission required: ${required}`
      : "Permission required for this operation.";
  }
  if (code === "TENANT_ACCESS_REQUIRED") {
    return "Cross-tenant access is blocked by policy in this wave.";
  }
  if (code === "PROCESS_SCHEMA_UNAVAILABLE") {
    return "Process schema is unavailable in this runtime.";
  }
  if (code === "OTP_RATE_LIMIT") return "Too many OTP requests. Please wait and try again.";
  if (code === "OTP_INVALID") return "Invalid OTP code.";
  if (code === "OTP_EXPIRED") return "OTP expired. Request a new code.";
  if (code === "OTP_DELIVERY_FAILED") return "Unable to send OTP email right now.";
  if (code === "OTP_EMAIL_UNAVAILABLE") return "No email is configured for this account.";
  if (code === "TOTP_REQUIRED") return "TOTP is required for this sign-in.";
  if (code === "TOTP_ENROLL_REQUIRED") return "TOTP enrollment is required for this account.";
  if (code === "INVALID_TOTP") return "Invalid TOTP code.";
  if (code === "TOTP_NOT_FOUND") return "TOTP is not configured for this account.";
  if (code === "TOTP_UNAVAILABLE") return "TOTP service is unavailable in this environment.";
  if (code === "DEVICE_REVOKED") return "This device is revoked. Contact an administrator.";
  if (code === "CONSENT_REQUIRED") return "Please accept the terms and privacy policy.";
  if (code === "BUSINESS_REG_REQUIRED") return "Business registration number is required.";
  if (code === "PERSONAL_ID_REQUIRED") return "Personal ID number is required for sole trader requests.";
  if (code === "INVALID_EMAIL") return "Please enter a valid email address.";
  return code || error.message || fallback;
}

export {
  ApiError,
  apiFetch,
  apiFetchWithMeta,
  buildPath,
  buildQuery,
  buildUrl,
  describeApiError,
  getCsrfToken,
  resetCsrfToken,
};
