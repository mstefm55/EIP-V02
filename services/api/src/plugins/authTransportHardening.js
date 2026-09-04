import fp from "fastify-plugin";
import { sha256Hex, timingSafeEqual } from "../auth/crypto.js";

function normalizeString(value) {
  return String(value ?? "").trim();
}

function parseCookieHeader(headerValue) {
  const raw = normalizeString(headerValue);
  if (!raw) return {};
  return raw.split(";").reduce((cookies, entry) => {
    const separator = entry.indexOf("=");
    if (separator <= 0) return cookies;
    const key = decodeURIComponent(entry.slice(0, separator).trim());
    const encoded = entry.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(encoded);
    } catch {
      cookies[key] = encoded;
    }
    return cookies;
  }, {});
}

function parseAllowedOrigins(value) {
  if (!value) return [];
  if (value === true || value === "*") return ["*"];
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeString(entry)).filter(Boolean);
  }
  return String(value)
    .split(",")
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function getRequestOrigin(request) {
  const origin = normalizeString(request?.headers?.origin);
  if (origin) return origin;
  const referer = normalizeString(request?.headers?.referer);
  if (!referer) return "";
  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}

function isTrustedOrigin(request, allowedOrigins) {
  const origin = getRequestOrigin(request);
  if (!origin) return true;
  if (allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(origin);
}

function addPartitionedAttribute(cookieValue) {
  const value = String(cookieValue || "").trim();
  if (!value || /(?:^|;)\s*Partitioned(?:;|$)/i.test(value)) return value;
  return `${value}; Partitioned`;
}

function hardenSetCookieHeaders(reply) {
  const current = reply.getHeader("set-cookie") ?? reply.getHeader("Set-Cookie");
  if (!current) return reply;

  const next = Array.isArray(current)
    ? current.map(addPartitionedAttribute)
    : addPartitionedAttribute(current);
  reply.header("Set-Cookie", next);
  return reply;
}

function assertPartitionedCookieConfig(app) {
  if (app.config?.AUTH_COOKIE_PARTITIONED !== true) return;
  const sameSite = normalizeString(app.config?.AUTH_COOKIE_SAMESITE).toLowerCase();
  if (sameSite !== "none") {
    throw new Error("AUTH_COOKIE_PARTITIONED requires AUTH_COOKIE_SAMESITE=none");
  }
  if (app.config?.AUTH_COOKIE_SECURE !== true) {
    throw new Error("AUTH_COOKIE_PARTITIONED requires AUTH_COOKIE_SECURE=true");
  }
  if (normalizeString(app.config?.AUTH_COOKIE_DOMAIN)) {
    throw new Error("AUTH_COOKIE_PARTITIONED requires host-only cookies; AUTH_COOKIE_DOMAIN must be empty");
  }
}

async function authTransportHardeningPlugin(app) {
  assertPartitionedCookieConfig(app);
  const allowedOrigins = parseAllowedOrigins(app.config?.corsOrigin);

  if (app.config?.AUTH_COOKIE_PARTITIONED === true) {
    const issueAuthCookies = app.issueAuthCookies.bind(app);
    app.issueAuthCookies = function issuePartitionedAuthCookies(reply, payload) {
      issueAuthCookies(reply, payload);
      return hardenSetCookieHeaders(reply);
    };

    const clearAuthCookies = app.clearAuthCookies.bind(app);
    app.clearAuthCookies = function clearPartitionedAuthCookies(reply) {
      clearAuthCookies(reply);
      return hardenSetCookieHeaders(reply);
    };
  }

  app.decorate("readCsrfTokenForSession", async function readCsrfTokenForSession(request) {
    if (!isTrustedOrigin(request, allowedOrigins)) {
      return { ok: false, status: 403, error: "ORIGIN_FORBIDDEN" };
    }

    const session = request.session || (await app.loadSession(request));
    if (!session) {
      return { ok: false, status: 401, error: "UNAUTHENTICATED" };
    }

    const cookies = request?.cookies && typeof request.cookies === "object"
      ? request.cookies
      : parseCookieHeader(request?.headers?.cookie);
    const cookieName = normalizeString(app.config?.AUTH_CSRF_COOKIE_NAME) || "csrf";
    const csrf = normalizeString(cookies[cookieName]);
    if (!csrf) {
      return { ok: false, status: 403, error: "CSRF_MISSING" };
    }

    const pepper = normalizeString(app.config?.AUTH_CSRF_PEPPER);
    if (!pepper) {
      return { ok: false, status: 503, error: "CSRF_UNAVAILABLE" };
    }

    const expectedHash = sha256Hex([
      session.id,
      csrf,
      session.tenant_id,
      session.identity_id,
      session.realm,
      pepper,
    ].join(":"));

    if (!session.csrf_secret_hash || !timingSafeEqual(String(session.csrf_secret_hash), expectedHash)) {
      return { ok: false, status: 403, error: "CSRF_INVALID" };
    }

    return { ok: true, session, csrf };
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const path = String(request?.raw?.url || request?.url || "").split("?")[0];
    if (path === "/api/eip/auth/whoami" || path === "/api/eip/auth/csrf") {
      reply.header("Cache-Control", "no-store, max-age=0");
      reply.header("Pragma", "no-cache");
    }
    return payload;
  });
}

export default fp(authTransportHardeningPlugin, {
  name: "auth-transport-hardening",
  dependencies: ["auth-shell"],
});

export {
  addPartitionedAttribute,
  assertPartitionedCookieConfig,
  hardenSetCookieHeaders,
};
