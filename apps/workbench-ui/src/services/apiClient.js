import { normalizeInternalApiPath } from "./apiEndpointSecurity.js";

const BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

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
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
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

function buildRequestBody(body) {
  if (body === undefined) return undefined;
  return JSON.stringify(body);
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

async function apiFetchWithMeta(path, options = {}) {
  const url = buildUrl(path);
  const method = normalizeMethod(options.method);
  const headers = {
    ...(options.headers || {}),
  };
  const hasBody = options.body !== undefined;

  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  if (shouldSendCsrf(method)) {
    const csrf = readCookie("csrf");
    if (csrf) headers["x-csrf"] = csrf;
  }

  const response = await fetch(url, {
    method,
    headers,
    credentials: "include",
    body: hasBody ? buildRequestBody(options.body) : undefined,
  });

  if (response.status === 304) {
    return { status: 304, headers: response.headers, data: null };
  }

  const { payload, rawBody } = await parseBody(response);
  if (!response.ok) {
    throw new ApiError(response.status, payload, rawBody);
  }

  return {
    status: response.status,
    headers: response.headers,
    data: payload,
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
};
