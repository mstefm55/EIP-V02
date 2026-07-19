import crypto from "node:crypto";
import fp from "fastify-plugin";
import { randomToken, sha256Hex, timingSafeEqual } from "../auth/crypto.js";
import { buildPermissionDecision, extractPermissionCodes } from "../security/permissionPolicy.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);
const DEFAULT_SESSION_TTL_MINUTES = 12 * 60;
const DEFAULT_SESSION_IDLE_TTL_MINUTES = 120;
const DEFAULT_SESSION_TOUCH_INTERVAL_SECONDS = 300;
const DEFAULT_DEVICE_COOKIE_DAYS = 90;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pick(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function normalizeRealm(value) {
  return normalizeString(value).toUpperCase();
}

function normalizeSameSite(value) {
  const candidate = normalizeString(value).toLowerCase();
  if (candidate === "strict" || candidate === "lax" || candidate === "none") {
    return candidate;
  }
  return "lax";
}

function parseCookieHeader(headerValue) {
  const cookieHeader = normalizeString(headerValue);
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce((accumulator, entry) => {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      return accumulator;
    }

    const key = decodeURIComponent(entry.slice(0, separatorIndex).trim());
    const rawValue = entry.slice(separatorIndex + 1).trim();
    try {
      accumulator[key] = decodeURIComponent(rawValue);
    } catch {
      accumulator[key] = rawValue;
    }
    return accumulator;
  }, {});
}

function parseAllowedOrigins(value) {
  if (!value) return [];
  if (value === true || value === "*") return ["*"];
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeString(entry))
      .filter(Boolean);
  }
  return String(value)
    .split(",")
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function getRequestOrigin(headers) {
  const origin = normalizeString(headers?.origin);
  if (origin) return origin;
  const referer = normalizeString(headers?.referer);
  if (!referer) return "";
  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}

function isOriginAllowed(origin, allowedOrigins) {
  const normalized = normalizeString(origin);
  if (!normalized) return false;
  if (allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(normalized);
}

function getRequestCookies(req) {
  if (req?.cookies && typeof req.cookies === "object") {
    return req.cookies;
  }
  return parseCookieHeader(req?.headers?.cookie);
}

function getHeaderValue(headers, names) {
  for (const name of names) {
    const rawValue = headers?.[name] ?? headers?.[name.toLowerCase()];
    if (Array.isArray(rawValue)) {
      const firstValue = rawValue[0];
      if (firstValue !== undefined && firstValue !== null && String(firstValue).trim() !== "") {
        return String(firstValue);
      }
    } else if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== "") {
      return String(rawValue);
    }
  }
  return "";
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value ?? "")}`];

  if (Number.isFinite(options.maxAge)) {
    parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  if (options.path) {
    parts.push(`Path=${options.path}`);
  }

  if (options.expires instanceof Date && Number.isFinite(options.expires.getTime())) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  if (options.sameSite) {
    const sameSite = normalizeSameSite(options.sameSite);
    parts.push(`SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`);
  }

  return parts.join("; ");
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function appendSetCookie(reply, cookieValue) {
  const current = reply.getHeader("set-cookie") ?? reply.getHeader("Set-Cookie");
  const next = Array.isArray(current)
    ? [...current, cookieValue]
    : current
      ? [String(current), cookieValue]
      : [cookieValue];
  reply.header("Set-Cookie", next);
}

function resolveAuthConfig(app) {
  const env = app?.config ?? {};
  const nodeEnv = String(pick(env.NODE_ENV, process.env.NODE_ENV) ?? "").toLowerCase();
  const isProduction = nodeEnv === "production";

  const sessionPepper = normalizeString(
    pick(
      env.AUTH_SESSION_PEPPER,
      process.env.AUTH_SESSION_PEPPER,
      env.SESSION_PEPPER,
      process.env.SESSION_PEPPER,
      env.API_KEY_PEPPER,
      process.env.API_KEY_PEPPER
    )
  );
  const csrfPepper = normalizeString(
    pick(
      env.AUTH_CSRF_PEPPER,
      process.env.AUTH_CSRF_PEPPER,
      env.CSRF_PEPPER,
      process.env.CSRF_PEPPER,
      env.API_KEY_PEPPER,
      process.env.API_KEY_PEPPER
    )
  );

  if (!sessionPepper) {
    throw new Error("AUTH_SESSION_PEPPER is required for auth shell");
  }
  if (!csrfPepper) {
    throw new Error("AUTH_CSRF_PEPPER is required for auth shell");
  }

  const sessionTtlMinutes = parseInteger(
    pick(env.AUTH_SESSION_TTL_MIN, process.env.AUTH_SESSION_TTL_MIN),
    DEFAULT_SESSION_TTL_MINUTES
  );
  const sessionIdleTtlMinutes = parseInteger(
    pick(env.AUTH_SESSION_IDLE_TTL_MIN, process.env.AUTH_SESSION_IDLE_TTL_MIN),
    DEFAULT_SESSION_IDLE_TTL_MINUTES
  );
  const sessionTouchIntervalSeconds = parseInteger(
    pick(env.AUTH_SESSION_TOUCH_INTERVAL_SEC, process.env.AUTH_SESSION_TOUCH_INTERVAL_SEC),
    DEFAULT_SESSION_TOUCH_INTERVAL_SECONDS
  );

  const cookieSecure = parseBoolean(
    pick(env.AUTH_COOKIE_SECURE, process.env.AUTH_COOKIE_SECURE),
    isProduction
  );
  const sameSite = normalizeSameSite(
    pick(env.AUTH_COOKIE_SAMESITE, process.env.AUTH_COOKIE_SAMESITE, "lax")
  );
  const cookiePath = normalizeString(pick(env.AUTH_COOKIE_PATH, process.env.AUTH_COOKIE_PATH, "/")) || "/";
  const cookieDomain = normalizeString(pick(env.AUTH_COOKIE_DOMAIN, process.env.AUTH_COOKIE_DOMAIN)) || null;
  const allowedOrigins = parseAllowedOrigins(pick(env.corsOrigin, process.env.CORS_ORIGIN));
  const csrfRequireOrigin = parseBoolean(
    pick(env.AUTH_CSRF_REQUIRE_ORIGIN, process.env.AUTH_CSRF_REQUIRE_ORIGIN),
    true
  );
  const sessionBindUserAgent = parseBoolean(
    pick(env.AUTH_SESSION_BIND_USER_AGENT, process.env.AUTH_SESSION_BIND_USER_AGENT),
    true
  );
  const devicePepper = normalizeString(
    pick(
      env.AUTH_DEVICE_PEPPER,
      process.env.AUTH_DEVICE_PEPPER,
      env.AUTH_SESSION_PEPPER,
      process.env.AUTH_SESSION_PEPPER,
      env.SESSION_PEPPER,
      process.env.SESSION_PEPPER,
      env.API_KEY_PEPPER,
      process.env.API_KEY_PEPPER
    )
  );
  const deviceCookieName =
    normalizeString(
      pick(env.AUTH_DEVICE_COOKIE_NAME, process.env.AUTH_DEVICE_COOKIE_NAME, "did")
    ) || "did";
  const deviceCookieDays = parseInteger(
    pick(env.AUTH_DEVICE_COOKIE_DAYS, process.env.AUTH_DEVICE_COOKIE_DAYS),
    DEFAULT_DEVICE_COOKIE_DAYS
  );

  return {
    nodeEnv,
    isProduction,
    sessionPepper,
    csrfPepper,
    sessionTtlMinutes,
    sessionIdleTtlMinutes,
    sessionTouchIntervalSeconds,
    cookieSecure: cookieSecure || sameSite === "none",
    sameSite,
    cookiePath,
    cookieDomain,
    allowedOrigins,
    csrfRequireOrigin,
    sessionBindUserAgent,
    devicePepper,
    deviceCookieName,
    deviceCookieDays,
    sessionCookieName: normalizeString(pick(env.AUTH_SESSION_COOKIE_NAME, process.env.AUTH_SESSION_COOKIE_NAME, "sid")) || "sid",
    csrfCookieName: normalizeString(pick(env.AUTH_CSRF_COOKIE_NAME, process.env.AUTH_CSRF_COOKIE_NAME, "csrf")) || "csrf",
  };
}

function assertAuthSessionId(sessionId) {
  const value = normalizeString(sessionId);
  if (!value || !UUID_RE.test(value)) {
    throw new Error("Invalid session id");
  }
  return value;
}

function hashSessionId({ sessionId, tenantId, identityId, realm, pepper }) {
  return sha256Hex([sessionId, tenantId, identityId, realm, pepper].join(":"));
}

function hashCsrfSecret({ sessionId, csrf, tenantId, identityId, realm, pepper }) {
  return sha256Hex([sessionId, csrf, tenantId, identityId, realm, pepper].join(":"));
}

function hashUserAgent(userAgent, pepper) {
  return sha256Hex([normalizeString(userAgent), pepper].join(":"));
}

function hashDeviceToken(deviceToken, pepper) {
  return sha256Hex([normalizeString(deviceToken), pepper].join(":"));
}

function buildAuthContext(session) {
  return {
    tenant_id: session.tenant_id,
    realm: session.realm,
    principal_type: "session",
    principal_id: session.id,
    identity_id: session.identity_id,
    roles: Array.isArray(session.role_codes) ? session.role_codes : [],
    permissions: Array.isArray(session.permission_codes) ? session.permission_codes : [],
  };
}

async function verifySessionTable(app) {
  if (!app?.db?.query) {
    throw new Error("Auth shell requires app.db before registration");
  }

  let tableResult;
  try {
    tableResult = await app.db.query(
      `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'eip_auth'
        AND table_name = 'auth_session'
      LIMIT 1
      `
    );
  } catch (error) {
    throw new Error(`Unable to verify eip_auth.auth_session table: ${error?.message || String(error)}`);
  }

  if (tableResult.rowCount === 0) {
    throw new Error("eip_auth.auth_session table is unavailable");
  }

  const requiredColumns = [
    "id",
    "tenant_id",
    "identity_id",
    "device_id",
    "issued_at",
    "expires_at",
    "csrf_secret_hash",
    "ip_address",
    "user_agent_hash",
    "is_revoked",
    "revoked_at",
    "attrs",
  ];

  const columnResult = await app.db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'eip_auth'
      AND table_name = 'auth_session'
    `
  );

  const presentColumns = new Set(columnResult.rows.map((row) => row.column_name));
  const missingColumns = requiredColumns.filter((column) => !presentColumns.has(column));
  if (missingColumns.length > 0) {
    throw new Error(
      `eip_auth.auth_session is missing required columns: ${missingColumns.join(", ")}`
    );
  }
}

async function verifyOptionalAuthTables(app) {
  const tableResult = await app.db.query(
    `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'eip_auth'
      AND table_name IN ('auth_device', 'auth_otp_challenge')
    `
  );
  const tableSet = new Set(tableResult.rows.map((row) => row.table_name));

  return {
    hasAuthDeviceTable: tableSet.has("auth_device"),
    hasAuthOtpChallengeTable: tableSet.has("auth_otp_challenge"),
  };
}

function makeSessionView(row, realm) {
  const attrs = row.attrs && typeof row.attrs === "object" ? row.attrs : {};
  const identityAttrs =
    row.identity_attrs && typeof row.identity_attrs === "object" ? row.identity_attrs : {};
  const permissionCodes = Array.isArray(row.permission_codes)
    ? row.permission_codes
    : extractPermissionCodes(identityAttrs);
  const roleCodes = Array.isArray(identityAttrs.roles)
    ? identityAttrs.roles.map((role) => String(role).trim()).filter(Boolean)
    : [];

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    identity_id: row.identity_id,
    device_id: row.device_id ?? null,
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    refresh_token_hash: row.refresh_token_hash ?? null,
    csrf_secret_hash: row.csrf_secret_hash ?? null,
    ip_address: row.ip_address ?? null,
    user_agent_hash: row.user_agent_hash ?? null,
    is_revoked: row.is_revoked === true,
    revoked_at: row.revoked_at ?? null,
    attrs,
    identity_attrs: identityAttrs,
    permission_codes: permissionCodes,
    role_codes: roleCodes,
    realm,
  };
}

function makeDeviceTrustView(row) {
  if (!row) return null;
  return {
    id: row.id,
    trust_state: row.trust_state,
  };
}

export default fp(async function authShell(app) {
  const config = resolveAuthConfig(app);
  await verifySessionTable(app);
  const optionalTables = await verifyOptionalAuthTables(app);

  if (!optionalTables.hasAuthDeviceTable) {
    app.log.warn({ event: "auth_device_table_missing", hint: "apply v2_0023_auth_stepup_device_otp.sql" });
  }
  if (!optionalTables.hasAuthOtpChallengeTable) {
    app.log.warn({ event: "auth_otp_challenge_table_missing", hint: "apply v2_0023_auth_stepup_device_otp.sql" });
  }

  app.decorateRequest("session", null);
  app.decorateRequest("auth", null);
  app.decorateRequest("realm", null);

  app.decorate("authFeatures", Object.freeze({
    hasAuthDeviceTable: optionalTables.hasAuthDeviceTable,
    hasAuthOtpChallengeTable: optionalTables.hasAuthOtpChallengeTable,
  }));

  app.decorate("readOrCreateDeviceToken", function readOrCreateDeviceToken(req) {
    const cookies = getRequestCookies(req);
    const current = normalizeString(cookies[config.deviceCookieName]);
    if (current && UUID_RE.test(current)) {
      return { token: current, generated: false };
    }
    return { token: crypto.randomUUID(), generated: true };
  });

  app.decorate("issueDeviceCookie", function issueDeviceCookie(reply, deviceToken) {
    const token = normalizeString(deviceToken);
    if (!token || !UUID_RE.test(token)) {
      throw new Error("device token must be a UUID");
    }
    const expires = new Date(Date.now() + config.deviceCookieDays * 24 * 60 * 60 * 1000);
    appendSetCookie(
      reply,
      serializeCookie(config.deviceCookieName, token, {
        path: config.cookiePath,
        sameSite: config.sameSite,
        secure: config.cookieSecure,
        domain: config.cookieDomain,
        httpOnly: true,
        expires,
      })
    );
    return { token, expires };
  });

  app.decorate("upsertBrowserDevice", async function upsertBrowserDevice({
    tenantId,
    identityId,
    deviceToken,
    userAgent,
    trustStateOnCreate = "untrusted",
  }) {
    if (!optionalTables.hasAuthDeviceTable) {
      return null;
    }
    const token = normalizeString(deviceToken);
    if (!token || !UUID_RE.test(token)) {
      throw new Error("deviceToken must be a UUID");
    }
    const deviceTokenHash = hashDeviceToken(token, config.devicePepper || config.sessionPepper);
    const userAgentHash = hashUserAgent(userAgent, config.sessionPepper);
    const trustState = trustStateOnCreate === "trusted" ? "trusted" : "untrusted";

    const upsertResult = await app.db.query(
      `
      INSERT INTO eip_auth.auth_device
        (tenant_id, identity_id, device_kind, device_token_hash, trust_state, attrs, first_seen_at, last_seen_at)
      VALUES
        ($1::uuid, $2::uuid, 'browser', $3, $4, $5::jsonb, now(), now())
      ON CONFLICT (tenant_id, identity_id, device_kind, device_token_hash)
      DO UPDATE
        SET last_seen_at = now(),
            attrs = COALESCE(eip_auth.auth_device.attrs, '{}'::jsonb) || EXCLUDED.attrs
      RETURNING id, trust_state, device_token_hash
      `,
      [
        tenantId,
        identityId,
        deviceTokenHash,
        trustState,
        JSON.stringify({
          user_agent_hash: userAgentHash,
        }),
      ]
    );

    let row = upsertResult.rows[0] || null;
    if (!row) return null;
    if (row.trust_state === "revoked") {
      return makeDeviceTrustView(row);
    }

    if (trustState === "trusted" && row.trust_state !== "trusted") {
      const trustResult = await app.db.query(
        `
        UPDATE eip_auth.auth_device
        SET trust_state = 'trusted',
            last_seen_at = now(),
            attrs = COALESCE(attrs, '{}'::jsonb)
        WHERE id = $1::uuid
        RETURNING id, trust_state, device_token_hash
        `,
        [row.id]
      );
      row = trustResult.rows[0] || row;
    }

    return makeDeviceTrustView(row);
  });

  app.decorate("loadBoundDevice", async function loadBoundDevice({
    deviceId,
    tenantId,
    identityId,
  }) {
    if (!optionalTables.hasAuthDeviceTable) return null;
    const result = await app.db.query(
      `
      SELECT id, trust_state, device_token_hash
      FROM eip_auth.auth_device
      WHERE id = $1::uuid
        AND tenant_id = $2::uuid
        AND identity_id = $3::uuid
      LIMIT 1
      `,
      [deviceId, tenantId, identityId]
    );
    return result.rows[0] || null;
  });

  app.decorate("issueAuthCookies", function issueAuthCookies(reply, {
    sid,
    csrf,
    did,
    expiresAt,
    deviceExpiresAt,
  } = {}) {
    const sessionId = assertAuthSessionId(sid);
    const csrfToken = normalizeString(csrf);
    const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (!csrfToken) {
      throw new Error("csrf is required to issue auth cookies");
    }
    if (!(expiry instanceof Date) || !Number.isFinite(expiry.getTime())) {
      throw new Error("expiresAt is required to issue auth cookies");
    }

    const cookieBase = {
      path: config.cookiePath,
      sameSite: config.sameSite,
      secure: config.cookieSecure,
      domain: config.cookieDomain,
    };

    appendSetCookie(
      reply,
      serializeCookie(config.sessionCookieName, sessionId, {
        ...cookieBase,
        httpOnly: true,
        expires: expiry,
      })
    );

    appendSetCookie(
      reply,
      serializeCookie(config.csrfCookieName, csrfToken, {
        ...cookieBase,
        httpOnly: false,
        expires: expiry,
      })
    );

    if (did && UUID_RE.test(String(did))) {
      const deviceExpiry = deviceExpiresAt instanceof Date && Number.isFinite(deviceExpiresAt.getTime())
        ? deviceExpiresAt
        : new Date(Date.now() + config.deviceCookieDays * 24 * 60 * 60 * 1000);
      appendSetCookie(
        reply,
        serializeCookie(config.deviceCookieName, String(did), {
          ...cookieBase,
          httpOnly: true,
          expires: deviceExpiry,
        })
      );
    }

    return reply;
  });

  app.decorate("clearAuthCookies", function clearAuthCookies(reply) {
    const expired = new Date(0);
    const cookieBase = {
      path: config.cookiePath,
      sameSite: config.sameSite,
      secure: config.cookieSecure,
      domain: config.cookieDomain,
      expires: expired,
      maxAge: 0,
    };

    appendSetCookie(
      reply,
      serializeCookie(config.sessionCookieName, "", {
        ...cookieBase,
        httpOnly: true,
      })
    );

    appendSetCookie(
      reply,
      serializeCookie(config.csrfCookieName, "", {
        ...cookieBase,
        httpOnly: false,
      })
    );

    appendSetCookie(
      reply,
      serializeCookie(config.deviceCookieName, "", {
        ...cookieBase,
        httpOnly: true,
      })
    );

    return reply;
  });

  app.decorate("loadSession", async function loadSession(req) {
    const cookies = getRequestCookies(req);
    const sid = normalizeString(cookies[config.sessionCookieName]);
    if (!sid || !UUID_RE.test(sid)) {
      return null;
    }

    const result = await app.db.query(
      `
      SELECT
        s.id,
        s.tenant_id,
        s.identity_id,
        s.device_id,
        s.issued_at,
        s.expires_at,
        s.refresh_token_hash,
        s.csrf_secret_hash,
        s.ip_address,
        s.user_agent_hash,
        s.is_revoked,
        s.revoked_at,
        COALESCE(s.attrs, '{}'::jsonb) AS attrs,
        ai.is_active AS identity_is_active,
        ai.is_locked AS identity_is_locked,
        COALESCE(ai.attrs, '{}'::jsonb) AS identity_attrs
      FROM eip_auth.auth_session AS s
      JOIN eip_auth.auth_identity AS ai
        ON ai.tenant_id = s.tenant_id
       AND ai.id = s.identity_id
      WHERE s.id = $1::uuid
      LIMIT 1
      `,
      [sid]
    );

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0];
    if (row.is_revoked) {
      return null;
    }
    if (row.identity_is_active !== true || row.identity_is_locked === true) {
      return null;
    }

    const expiresAt = new Date(row.expires_at);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return null;
    }

    const attrs = row.attrs && typeof row.attrs === "object" ? row.attrs : {};
    const idleTtlMs = Math.max(0, config.sessionIdleTtlMinutes) * 60 * 1000;
    if (idleTtlMs > 0) {
      const lastSeenRaw = normalizeString(attrs.last_seen_at) || row.issued_at;
      const lastSeen = new Date(lastSeenRaw);
      if (
        Number.isFinite(lastSeen.getTime())
        && Date.now() - lastSeen.getTime() > idleTtlMs
      ) {
        await app.db.query(
          `
          UPDATE eip_auth.auth_session
          SET is_revoked = true,
              revoked_at = COALESCE(revoked_at, now()),
              attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object('revoked_reason', 'idle_timeout')
          WHERE id = $1::uuid
            AND tenant_id = $2::uuid
            AND identity_id = $3::uuid
          `,
          [row.id, row.tenant_id, row.identity_id]
        );
        return null;
      }

      const touchIntervalMs = Math.max(1, config.sessionTouchIntervalSeconds) * 1000;
      if (
        Number.isFinite(lastSeen.getTime())
        && Date.now() - lastSeen.getTime() >= touchIntervalMs
      ) {
        const nowIso = new Date().toISOString();
        await app.db.query(
          `
          UPDATE eip_auth.auth_session
          SET attrs = COALESCE(attrs, '{}'::jsonb)
                    || jsonb_build_object('last_seen_at', $2::text)
          WHERE id = $1::uuid
            AND tenant_id = $3::uuid
            AND identity_id = $4::uuid
          `,
          [row.id, nowIso, row.tenant_id, row.identity_id]
        );
        attrs.last_seen_at = nowIso;
      }
    }

    const realm = normalizeRealm(attrs.realm);
    if (!realm) {
      return null;
    }

    const expectedSidHash = hashSessionId({
      sessionId: sid,
      tenantId: row.tenant_id,
      identityId: row.identity_id,
      realm,
      pepper: config.sessionPepper,
    });

    if (!attrs.sid_hash || !timingSafeEqual(String(attrs.sid_hash), expectedSidHash)) {
      return null;
    }

    if (config.sessionBindUserAgent) {
      const expectedUserAgentHash = hashUserAgent(req?.headers?.["user-agent"], config.sessionPepper);
      if (
        !row.user_agent_hash
        || !timingSafeEqual(String(row.user_agent_hash), expectedUserAgentHash)
      ) {
        await app.db.query(
          `
          UPDATE eip_auth.auth_session
          SET is_revoked = true,
              revoked_at = COALESCE(revoked_at, now()),
              attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object('revoked_reason', 'user_agent_mismatch')
          WHERE id = $1::uuid
          `,
          [row.id]
        );
        return null;
      }
    }

    if (optionalTables.hasAuthDeviceTable && row.device_id) {
      const deviceToken = normalizeString(cookies[config.deviceCookieName]);
      if (!deviceToken || !UUID_RE.test(deviceToken)) {
        return null;
      }
      const boundDevice = await app.loadBoundDevice({
        deviceId: row.device_id,
        tenantId: row.tenant_id,
        identityId: row.identity_id,
      });
      if (!boundDevice || boundDevice.trust_state === "revoked") {
        return null;
      }
      const expectedDeviceHash = hashDeviceToken(deviceToken, config.devicePepper || config.sessionPepper);
      if (
        !boundDevice.device_token_hash
        || !timingSafeEqual(String(boundDevice.device_token_hash), expectedDeviceHash)
      ) {
        return null;
      }
    }

    const identityAttrs =
      row.identity_attrs && typeof row.identity_attrs === "object" ? row.identity_attrs : {};
    const permissionCodes = extractPermissionCodes(identityAttrs);
    const session = makeSessionView(
      {
        ...row,
        attrs,
        identity_attrs: identityAttrs,
        permission_codes: permissionCodes,
      },
      realm
    );
    req.session = session;
    req.realm = realm;
    req.auth = buildAuthContext(session);

    return session;
  });

  app.decorate("requireSession", async function requireSession(req, options = {}) {
    const session = req.session || (await app.loadSession(req));
    if (!session) {
      return { ok: false, status: 401, error: "UNAUTHENTICATED" };
    }

    const expectedRealm = normalizeRealm(options.realm);
    if (expectedRealm && session.realm !== expectedRealm) {
      return { ok: false, status: 403, error: "WRONG_REALM" };
    }

    req.session = session;
    req.realm = session.realm;
    req.auth = buildAuthContext(session);

    return { ok: true, session };
  });

  app.decorate("requirePermission", async function requirePermission(req, permissionCodes, options = {}) {
    const requiredRealm = options.realm ?? "EIP";
    const sessionResult = await app.requireSession(req, { realm: requiredRealm });
    if (!sessionResult.ok) {
      return sessionResult;
    }

    const session = sessionResult.session;
    const decision = buildPermissionDecision({
      requiredPermissions: permissionCodes,
      grantedPermissions: session.permission_codes,
    });

    req.session = session;
    req.realm = session.realm;
    req.auth = buildAuthContext(session);

    if (!decision.ok) {
      return {
        ok: false,
        status: 403,
        error: decision.reason || "PERMISSION_REQUIRED",
        required_permissions: decision.requiredPermissions,
        granted_permissions: decision.grantedPermissions,
      };
    }

    return {
      ok: true,
      session,
      required_permissions: decision.requiredPermissions,
      granted_permissions: decision.grantedPermissions,
    };
  });

  app.decorate("requireCsrf", async function requireCsrf(req) {
    const method = String(req?.method || "GET").toUpperCase();
    if (SAFE_METHODS.has(method)) {
      return { ok: true };
    }

    if (config.csrfRequireOrigin) {
      const origin = getRequestOrigin(req?.headers);
      if (!isOriginAllowed(origin, config.allowedOrigins)) {
        return { ok: false, status: 403, error: "ORIGIN_FORBIDDEN" };
      }
    }

    const session = req.session || (await app.loadSession(req));
    if (!session) {
      return { ok: false, status: 401, error: "UNAUTHENTICATED" };
    }

    const cookies = getRequestCookies(req);
    const csrfCookie = normalizeString(cookies[config.csrfCookieName]);
    const csrfHeader = normalizeString(
      getHeaderValue(req?.headers, ["x-csrf", "x-csrf-token"])
    );

    if (!csrfCookie || !csrfHeader) {
      return { ok: false, status: 403, error: "CSRF_MISSING" };
    }

    if (csrfCookie !== csrfHeader) {
      return { ok: false, status: 403, error: "CSRF_MISMATCH" };
    }

    const expectedCsrfHash = hashCsrfSecret({
      sessionId: session.id,
      csrf: csrfCookie,
      tenantId: session.tenant_id,
      identityId: session.identity_id,
      realm: session.realm,
      pepper: config.csrfPepper,
    });

    if (!session.csrf_secret_hash || !timingSafeEqual(String(session.csrf_secret_hash), expectedCsrfHash)) {
      return { ok: false, status: 403, error: "CSRF_INVALID" };
    }

    req.session = session;
    req.realm = session.realm;
    req.auth = buildAuthContext(session);

    return { ok: true, session };
  });

  app.decorate("createSession", async function createSession({
    tenantId,
    identityId,
    realm,
    deviceId = null,
    assurance = "password",
    ip,
    userAgent,
  } = {}) {
    const resolvedRealm = normalizeRealm(realm);
    if (!normalizeString(tenantId)) {
      throw new Error("tenantId is required to create a session");
    }
    if (!normalizeString(identityId)) {
      throw new Error("identityId is required to create a session");
    }
    if (!resolvedRealm) {
      throw new Error("realm is required to create a session");
    }
    const normalizedDeviceId = normalizeString(deviceId) || null;
    if (normalizedDeviceId && !UUID_RE.test(normalizedDeviceId)) {
      throw new Error("deviceId must be a UUID when provided");
    }

    const sid = crypto.randomUUID();
    const csrf = randomToken(32);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + config.sessionTtlMinutes * 60 * 1000);
    const sidHash = hashSessionId({
      sessionId: sid,
      tenantId,
      identityId,
      realm: resolvedRealm,
      pepper: config.sessionPepper,
    });
    const csrfHash = hashCsrfSecret({
      sessionId: sid,
      csrf,
      tenantId,
      identityId,
      realm: resolvedRealm,
      pepper: config.csrfPepper,
    });
    const userAgentHash = hashUserAgent(userAgent, config.sessionPepper);

    const result = await app.db.query(
      `
      INSERT INTO eip_auth.auth_session
        (id, tenant_id, identity_id, device_id, issued_at, expires_at, csrf_secret_hash, ip_address, user_agent_hash, attrs)
      VALUES
        ($1::uuid, $2::uuid, $3::uuid, $4::uuid, now(), $5, $6, $7, $8, $9::jsonb)
      RETURNING
        id,
        tenant_id,
        identity_id,
        device_id,
        issued_at,
        expires_at,
        refresh_token_hash,
        csrf_secret_hash,
        ip_address,
        user_agent_hash,
        is_revoked,
        revoked_at,
        attrs
      `,
      [
        sid,
        tenantId,
        identityId,
        normalizedDeviceId,
        expiresAt,
        csrfHash,
        normalizeString(ip) || null,
        userAgentHash,
        JSON.stringify({
          realm: resolvedRealm,
          sid_hash: sidHash,
          assurance: normalizeString(assurance) || "password",
          last_seen_at: nowIso,
        }),
      ]
    );

    const session = makeSessionView(result.rows[0], resolvedRealm);
    return {
      sid,
      csrf,
      expiresAt,
      session,
    };
  });

  app.decorate("revokeSession", async function revokeSession(sessionId, tenantId = null) {
    const sid = assertAuthSessionId(sessionId);
    const scopedTenantId = normalizeString(tenantId);
    const result = await app.db.query(
      `
      UPDATE eip_auth.auth_session
      SET is_revoked = true,
          revoked_at = COALESCE(revoked_at, now())
      WHERE id = $1::uuid
        AND ($2::uuid IS NULL OR tenant_id = $2::uuid)
      RETURNING id
      `,
      [sid, scopedTenantId || null]
    );

    return {
      ok: true,
      revoked: result.rowCount > 0,
    };
  });

  app.decorate("loadTenant", async function loadTenant(tenantRef) {
    const ref = normalizeString(tenantRef);
    if (!ref) return null;

    if (isUuid(ref)) {
      const kernel = await app.db.query(
        `
        SELECT tenant_id, tenant_code, tenant_name
        FROM kernel.tenants
        WHERE tenant_id = $1::uuid
          AND tenant_status = 'active'
        LIMIT 1
        `,
        [ref]
      );
      if (kernel.rowCount === 1) return kernel.rows[0];
      return null;
    }

    const kernel = await app.db.query(
      `
      SELECT tenant_id, tenant_code, tenant_name
      FROM kernel.tenants
      WHERE lower(tenant_code) = lower($1)
        AND tenant_status = 'active'
      LIMIT 1
      `,
      [ref]
    );
    return kernel.rows[0] ?? null;
  });

  app.decorate("loadIdentity", async function loadIdentity(tenantId, login) {
    const loginValue = normalizeString(login).toLowerCase();
    if (!normalizeString(tenantId) || !loginValue) return null;

    const identityRes = await app.db.query(
      `
      SELECT id, tenant_id, login, is_active, is_locked, COALESCE(attrs,'{}'::jsonb) AS attrs
      FROM eip_auth.auth_identity
      WHERE tenant_id = $1::uuid
        AND lower(login) = lower($2)
      LIMIT 1
      `,
      [tenantId, loginValue]
    );
    return identityRes.rows[0] ?? null;
  });

  app.decorate("loadPasswordCredential", async function loadPasswordCredential(tenantId, identityId) {
    if (!normalizeString(tenantId) || !normalizeString(identityId)) return null;
    const credentialRes = await app.db.query(
      `
      SELECT secret_hash, algorithm
      FROM eip_auth.auth_credential
      WHERE tenant_id = $1::uuid
        AND identity_id = $2::uuid
        AND credential_type = 'password'
        AND is_revoked = false
        AND (valid_to IS NULL OR valid_to > now())
      ORDER BY valid_from DESC NULLS LAST, created_at DESC
      LIMIT 1
      `,
      [tenantId, identityId]
    );
    return credentialRes.rows[0] ?? null;
  });

  app.decorate("loadTotpCredential", async function loadTotpCredential(tenantId, identityId) {
    if (!normalizeString(tenantId) || !normalizeString(identityId)) return null;
    const credentialRes = await app.db.query(
      `
      SELECT id, secret_hash, algorithm, meta
      FROM eip_auth.auth_credential
      WHERE tenant_id = $1::uuid
        AND identity_id = $2::uuid
        AND credential_type = 'totp'
        AND is_revoked = false
        AND (valid_to IS NULL OR valid_to > now())
      ORDER BY valid_from DESC NULLS LAST, created_at DESC
      LIMIT 1
      `,
      [tenantId, identityId]
    );
    return credentialRes.rows[0] ?? null;
  });
}, {
  name: "auth-shell",
});
