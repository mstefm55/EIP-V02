import crypto from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import { verifyPassword } from "../auth/password.js";
import { randomDigits, sha256Hex, timingSafeEqual } from "../auth/crypto.js";
import { sendEmail } from "../lib/email.js";

const AUTH_REALM = "EIP";
const OTP_REQUEST_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };
const OTP_VERIFY_RATE_LIMIT = { max: 30, timeWindow: "1 minute" };
const PASSWORD_LOGIN_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };
const TOTP_BOOTSTRAP_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };
const TOTP_LOGIN_RATE_LIMIT = { max: 25, timeWindow: "1 minute" };
const DEFAULT_OTP_TTL_SECONDS = 600;
const DEFAULT_OTP_MAX_ATTEMPTS = 6;
const DEFAULT_OTP_RECENT_WINDOW_MIN = 10;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const TOTP_DIGITS = 6;
const DEFAULT_LOGIN_FAILURE_THRESHOLD = 8;
const DEFAULT_LOGIN_LOCK_MINUTES = 15;

function sendFailure(reply, result) {
  return reply.code(result.status || 400).send({
    ok: false,
    error: result.error || "BAD_REQUEST",
  });
}

function minimalAuthContext(session) {
  return {
    ok: true,
    tenant_id: session.tenant_id,
    identity_id: session.identity_id,
    realm: session.realm,
    device_id: session.device_id || null,
    assurance: session.attrs?.assurance || "password",
    expires_at: session.expires_at,
    permissions: Array.isArray(session.permission_codes) ? session.permission_codes : [],
  };
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeOtpCode(value) {
  return normalizeString(value).replace(/\s+/g, "");
}

function readLoginValue(body = {}) {
  return normalizeString(body.login ?? body.email).toLowerCase();
}

function readTenantValue(body = {}) {
  return normalizeString(body.tenantId ?? body.tenantCode);
}

function readChallengeId(body = {}) {
  return normalizeString(body.challengeId ?? body.challenge_id);
}

function readOtpValue(body = {}) {
  return normalizeOtpCode(body.otp ?? body.code ?? body.token ?? body.totpCode);
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAllowedOrigins(app) {
  const raw = app.config?.corsOrigin;
  if (!raw) return [];
  if (raw === true || raw === "*") return ["*"];
  if (Array.isArray(raw)) return raw.map((entry) => String(entry).trim()).filter(Boolean);
  return String(raw)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getRequestOrigin(request) {
  const origin = request.headers?.origin;
  if (origin) return String(origin).trim();

  const referer = request.headers?.referer;
  if (!referer) return "";
  try {
    return new URL(String(referer)).origin;
  } catch {
    return "";
  }
}

function isTrustedOrigin(request, allowedOrigins) {
  const requestOrigin = getRequestOrigin(request);
  if (!requestOrigin) return true;
  if (allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(requestOrigin);
}

function isEmail(value) {
  const candidate = normalizeString(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate);
}

function authBodySchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      tenantId: { type: "string", minLength: 1 },
      tenantCode: { type: "string", minLength: 1 },
      login: { type: "string", minLength: 1 },
      email: { type: "string", minLength: 1 },
      password: { type: "string", minLength: 1 },
    },
    anyOf: [{ required: ["tenantId"] }, { required: ["tenantCode"] }],
    required: ["password"],
  };
}

function otpRequestSchema() {
  return authBodySchema();
}

function otpLoginSchema() {
  return {
    ...authBodySchema(),
    properties: {
      ...authBodySchema().properties,
      challengeId: { type: "string", minLength: 1 },
      otp: { type: "string", minLength: 4, maxLength: 12 },
    },
    required: ["password", "challengeId", "otp"],
  };
}

function totpLoginSchema() {
  return {
    ...authBodySchema(),
    properties: {
      ...authBodySchema().properties,
      token: { type: "string", minLength: 4, maxLength: 12 },
      totp: { type: "string", minLength: 4, maxLength: 12 },
    },
    anyOf: [
      { required: ["tenantId", "password", "token"] },
      { required: ["tenantCode", "password", "token"] },
      { required: ["tenantId", "password", "totp"] },
      { required: ["tenantCode", "password", "totp"] },
    ],
  };
}

function getOtpConfig(app) {
  return {
    pepper: normalizeString(
      app.config?.AUTH_OTP_PEPPER
      || app.config?.AUTH_SESSION_PEPPER
      || process.env.AUTH_OTP_PEPPER
      || process.env.OTP_PEPPER
      || process.env.AUTH_SESSION_PEPPER
    ),
    ttlSeconds: parseInteger(app.config?.AUTH_OTP_TTL_SEC ?? process.env.AUTH_OTP_TTL_SEC, DEFAULT_OTP_TTL_SECONDS),
    maxAttempts: parseInteger(app.config?.AUTH_OTP_MAX_ATTEMPTS ?? process.env.AUTH_OTP_MAX_ATTEMPTS, DEFAULT_OTP_MAX_ATTEMPTS),
    recentWindowMinutes: parseInteger(
      app.config?.AUTH_OTP_RECENT_WINDOW_MIN ?? process.env.AUTH_OTP_RECENT_WINDOW_MIN,
      DEFAULT_OTP_RECENT_WINDOW_MIN
    ),
  };
}

function getLoginSecurityConfig(app) {
  return {
    failureThreshold: parseInteger(
      app.config?.AUTH_LOGIN_FAILURE_THRESHOLD ?? process.env.AUTH_LOGIN_FAILURE_THRESHOLD,
      DEFAULT_LOGIN_FAILURE_THRESHOLD
    ),
    lockMinutes: parseInteger(
      app.config?.AUTH_LOGIN_LOCK_MIN ?? process.env.AUTH_LOGIN_LOCK_MIN,
      DEFAULT_LOGIN_LOCK_MINUTES
    ),
  };
}

function isIdentityTemporarilyLocked(identity) {
  const attrs = identity?.attrs && typeof identity.attrs === "object" ? identity.attrs : {};
  const lockUntilRaw = normalizeString(attrs.login_lock_until || attrs.lock_until);
  if (!lockUntilRaw) return false;
  const lockUntil = new Date(lockUntilRaw);
  return Number.isFinite(lockUntil.getTime()) && lockUntil.getTime() > Date.now();
}

async function noteFailedLoginAttempt(app, { tenantId, identityId, threshold, lockMinutes }) {
  if (!tenantId || !identityId) return;
  if (!Number.isFinite(threshold) || threshold <= 0) return;

  await app.db.query(
    `
    UPDATE eip_auth.auth_identity
    SET attrs =
          COALESCE(attrs, '{}'::jsonb)
          || jsonb_build_object(
               'failed_login_count',
               COALESCE((attrs->>'failed_login_count')::int, 0) + 1,
               'last_failed_login_at',
               now()::text
             )
          || CASE
               WHEN COALESCE((attrs->>'failed_login_count')::int, 0) + 1 >= $3::int
               THEN jsonb_build_object(
                      'login_lock_until',
                      (now() + ($4::int * interval '1 minute'))::text
                    )
               ELSE '{}'::jsonb
             END,
        updated_at = now()
    WHERE tenant_id = $1::uuid
      AND id = $2::uuid
    `,
    [tenantId, identityId, threshold, Math.max(1, lockMinutes || 1)]
  );
}

async function clearFailedLoginAttemptState(app, { tenantId, identityId }) {
  if (!tenantId || !identityId) return;

  await app.db.query(
    `
    UPDATE eip_auth.auth_identity
    SET attrs = COALESCE(attrs, '{}'::jsonb)
              - 'failed_login_count'
              - 'last_failed_login_at'
              - 'login_lock_until',
        updated_at = now()
    WHERE tenant_id = $1::uuid
      AND id = $2::uuid
    `,
    [tenantId, identityId]
  );
}

function getTotpSecretKey(app) {
  const raw = normalizeString(app.config?.AUTH_TOTP_SECRET_KEY || process.env.AUTH_TOTP_SECRET_KEY || process.env.TOTP_SECRET_KEY);
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    return null;
  }
  return Buffer.from(raw, "hex");
}

function getTotpIssuer(app) {
  return normalizeString(app.config?.AUTH_TOTP_ISSUER || process.env.AUTH_TOTP_ISSUER || process.env.TOTP_ISSUER || "EIP");
}

function encryptTotpSecret(secret, keyBuffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `encv1:${Buffer.concat([iv, authTag, encrypted]).toString("base64url")}`;
}

function decryptTotpSecret(secretValue, keyBuffer) {
  const raw = normalizeString(secretValue);
  if (!raw) return null;
  if (!raw.startsWith("encv1:")) return raw;
  if (!keyBuffer) return null;

  try {
    const packed = Buffer.from(raw.slice("encv1:".length), "base64url");
    const iv = packed.subarray(0, 12);
    const authTag = packed.subarray(12, 28);
    const encrypted = packed.subarray(28);
    if (iv.length !== 12 || authTag.length !== 16 || encrypted.length === 0) {
      return null;
    }
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function resolveOtpRecipient(identity, login) {
  const attrs = identity?.attrs && typeof identity.attrs === "object" ? identity.attrs : {};
  const identityEmail = normalizeString(attrs.email || attrs.recovery_email).toLowerCase();
  if (isEmail(identityEmail)) {
    return identityEmail;
  }
  if (isEmail(login)) {
    return login;
  }
  return null;
}

function isPrivilegedIdentity(identity) {
  const attrs = identity?.attrs && typeof identity.attrs === "object" ? identity.attrs : {};
  const permissions = Array.isArray(attrs.permissions)
    ? attrs.permissions.map((entry) => normalizeString(entry).toUpperCase()).filter(Boolean)
    : [];
  return permissions.some((code) => code.includes("ADMIN") || code.endsWith("_WRITE") || code.includes("MANAGE"));
}

async function verifyPrimaryFactor(app, { tenantRef, login, password }) {
  if (!tenantRef || !login || !password) {
    return { ok: false, status: 400, error: "BAD_REQUEST" };
  }

  const loginSecurity = getLoginSecurityConfig(app);

  const tenant = await app.loadTenant(tenantRef);
  if (!tenant) {
    return { ok: false, status: 401, error: "LOGIN_FAILED" };
  }

  const identity = await app.loadIdentity(tenant.tenant_id, login);
  if (!identity || identity.is_active !== true || identity.is_locked === true) {
    return { ok: false, status: 401, error: "LOGIN_FAILED" };
  }
  if (isIdentityTemporarilyLocked(identity)) {
    return { ok: false, status: 401, error: "LOGIN_FAILED" };
  }

  const credential = await app.loadPasswordCredential(tenant.tenant_id, identity.id);
  if (!credential) {
    await noteFailedLoginAttempt(app, {
      tenantId: tenant.tenant_id,
      identityId: identity.id,
      threshold: loginSecurity.failureThreshold,
      lockMinutes: loginSecurity.lockMinutes,
    });
    return { ok: false, status: 401, error: "LOGIN_FAILED" };
  }

  const passwordOk = await verifyPassword(password, credential);
  if (!passwordOk) {
    await noteFailedLoginAttempt(app, {
      tenantId: tenant.tenant_id,
      identityId: identity.id,
      threshold: loginSecurity.failureThreshold,
      lockMinutes: loginSecurity.lockMinutes,
    });
    return { ok: false, status: 401, error: "LOGIN_FAILED" };
  }

  await clearFailedLoginAttemptState(app, {
    tenantId: tenant.tenant_id,
    identityId: identity.id,
  });

  return { ok: true, tenant, identity };
}

async function resolveDeviceContext(app, request, { tenantId, identityId, trustStateOnCreate = "untrusted" }) {
  const deviceContext = app.readOrCreateDeviceToken(request);
  if (!app.authFeatures?.hasAuthDeviceTable) {
    return {
      deviceToken: deviceContext.token,
      deviceCookieGenerated: deviceContext.generated,
      deviceRow: null,
      deviceExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    };
  }

  const deviceRow = await app.upsertBrowserDevice({
    tenantId,
    identityId,
    deviceToken: deviceContext.token,
    userAgent: request.headers["user-agent"],
    trustStateOnCreate,
  });

  const deviceExpiresAt = new Date(
    Date.now() + Number(app.config?.AUTH_DEVICE_COOKIE_DAYS || 90) * 24 * 60 * 60 * 1000
  );

  return {
    deviceToken: deviceContext.token,
    deviceCookieGenerated: deviceContext.generated,
    deviceRow,
    deviceExpiresAt,
  };
}

export default async function authRoutes(app) {
  const allowedOrigins = parseAllowedOrigins(app);

  app.post(
    "/auth/login/password",
    {
      config: { rateLimit: PASSWORD_LOGIN_RATE_LIMIT },
      schema: { body: authBodySchema() },
    },
    async (request, reply) => {
      try {
        const body = request.body || {};
        const tenantRef = readTenantValue(body);
        const login = readLoginValue(body);
        const password = normalizeString(body.password);

        if (!isTrustedOrigin(request, allowedOrigins)) {
          return sendFailure(reply, { status: 403, error: "ORIGIN_FORBIDDEN" });
        }

        const primary = await verifyPrimaryFactor(app, {
          tenantRef,
          login,
          password,
        });
        if (!primary.ok) {
          return sendFailure(reply, primary);
        }

        const { tenant, identity } = primary;
        const totpCredential = await app.loadTotpCredential(tenant.tenant_id, identity.id);
        const requiresTotpEnrollment = app.config?.AUTH_REQUIRE_TOTP_FOR_PRIVILEGED === true
          && isPrivilegedIdentity(identity)
          && !totpCredential;

        if (requiresTotpEnrollment) {
          return sendFailure(reply, { status: 403, error: "TOTP_ENROLL_REQUIRED" });
        }

        const deviceContext = await resolveDeviceContext(app, request, {
          tenantId: tenant.tenant_id,
          identityId: identity.id,
          trustStateOnCreate: "untrusted",
        });

        if (deviceContext.deviceRow?.trust_state === "revoked") {
          return sendFailure(reply, { status: 401, error: "DEVICE_REVOKED" });
        }

        const requiresTotp = Boolean(totpCredential)
          && (
            app.config?.AUTH_REQUIRE_TOTP_FOR_PRIVILEGED !== true
            || isPrivilegedIdentity(identity)
          );

        if (requiresTotp && deviceContext.deviceRow && deviceContext.deviceRow.trust_state !== "trusted") {
          return sendFailure(reply, { status: 403, error: "TOTP_REQUIRED" });
        }

        const created = await app.createSession({
          tenantId: tenant.tenant_id,
          identityId: identity.id,
          deviceId: deviceContext.deviceRow?.id || null,
          assurance: requiresTotp ? "trusted_device_password" : "password",
          realm: AUTH_REALM,
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        });

        app.issueAuthCookies(reply, {
          ...created,
          did: deviceContext.deviceToken,
          deviceExpiresAt: deviceContext.deviceExpiresAt,
        });

        return reply.send({
          ok: true,
          tenant_id: tenant.tenant_id,
          identity_id: identity.id,
          realm: AUTH_REALM,
          assurance: created.session?.attrs?.assurance || "password",
        });
      } catch (error) {
        request.log.error({ event: "auth_login_error", message: error?.message || String(error) });
        return sendFailure(reply, { status: 500, error: "AUTH_UNAVAILABLE" });
      }
    }
  );

  app.post(
    "/auth/request-otp",
    {
      config: { rateLimit: OTP_REQUEST_RATE_LIMIT },
      schema: { body: otpRequestSchema() },
    },
    async (request, reply) => {
      try {
        if (!app.authFeatures?.hasAuthOtpChallengeTable) {
          return sendFailure(reply, { status: 503, error: "OTP_UNAVAILABLE" });
        }

        const body = request.body || {};
        const tenantRef = readTenantValue(body);
        const login = readLoginValue(body);
        const password = normalizeString(body.password);

        if (!isTrustedOrigin(request, allowedOrigins)) {
          return sendFailure(reply, { status: 403, error: "ORIGIN_FORBIDDEN" });
        }

        const otpConfig = getOtpConfig(app);
        if (!otpConfig.pepper) {
          return sendFailure(reply, { status: 503, error: "OTP_UNAVAILABLE" });
        }

        const primary = await verifyPrimaryFactor(app, { tenantRef, login, password });
        if (!primary.ok) {
          return sendFailure(reply, primary);
        }

        const { tenant, identity } = primary;
        const recipient = resolveOtpRecipient(identity, login);
        if (!recipient) {
          return sendFailure(reply, { status: 400, error: "OTP_EMAIL_UNAVAILABLE" });
        }

        const recentResult = await app.db.query(
          `
          SELECT count(*)::int AS recent_count
          FROM eip_auth.auth_otp_challenge
          WHERE tenant_id = $1::uuid
            AND identity_id = $2::uuid
            AND created_at > now() - ($3::int * interval '1 minute')
          `,
          [tenant.tenant_id, identity.id, otpConfig.recentWindowMinutes]
        );

        if ((recentResult.rows[0]?.recent_count || 0) >= 5) {
          return sendFailure(reply, { status: 429, error: "OTP_RATE_LIMIT" });
        }

        const challengeId = crypto.randomUUID();
        const otp = randomDigits(6);
        const expiresAt = new Date(Date.now() + otpConfig.ttlSeconds * 1000);
        const otpHash = sha256Hex(`${otp}:${challengeId}:${otpConfig.pepper}`);

        await app.db.query(
          `
          INSERT INTO eip_auth.auth_otp_challenge
            (id, tenant_id, identity_id, channel, otp_hash, max_attempt_count, expires_at, ip_address, attrs)
          VALUES
            ($1::uuid, $2::uuid, $3::uuid, 'email', $4, $5, $6, $7, $8::jsonb)
          `,
          [
            challengeId,
            tenant.tenant_id,
            identity.id,
            otpHash,
            otpConfig.maxAttempts,
            expiresAt,
            normalizeString(request.ip) || null,
            JSON.stringify({ login_hint: login.slice(0, 3) }),
          ]
        );

        const otpExpiresMin = Math.max(1, Math.round(otpConfig.ttlSeconds / 60));
        const subject = "Your EIP one-time code";
        const text = `Your EIP one-time code is ${otp}. It expires in ${otpExpiresMin} minutes.`;
        const html = `<p>Your EIP one-time code is <strong>${otp}</strong>.</p><p>It expires in ${otpExpiresMin} minutes.</p>`;

        const isDevLogAllowed = app.config?.LOG_DEV_OTP === true && app.config?.NODE_ENV !== "production";

        try {
          if (isDevLogAllowed) {
            request.log.info({ event: "dev_otp", challenge_id: challengeId, otp, recipient });
          }
          await sendEmail(app, recipient, subject, text, html);
        } catch (deliveryError) {
          const smtpConfigured = Boolean(app.config?.SMTP_HOST && app.config?.SMTP_USER && app.config?.SMTP_PASS);
          if (!(isDevLogAllowed && !smtpConfigured)) {
            await app.db.query(
              `
              UPDATE eip_auth.auth_otp_challenge
              SET is_consumed = true,
                  consumed_at = now(),
                  attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object('delivery_error', $2::text)
              WHERE id = $1::uuid
                AND tenant_id = $3::uuid
                AND identity_id = $4::uuid
              `,
              [challengeId, normalizeString(deliveryError?.message || "delivery_failed"), tenant.tenant_id, identity.id]
            );
            request.log.error({ event: "otp_email_failed", message: deliveryError?.message || String(deliveryError) });
            return sendFailure(reply, { status: 503, error: "OTP_DELIVERY_FAILED" });
          }
        }

        return reply.send({
          ok: true,
          challenge_id: challengeId,
          expires_at: expiresAt.toISOString(),
        });
      } catch (error) {
        request.log.error({ event: "request_otp_error", message: error?.message || String(error) });
        return sendFailure(reply, { status: 500, error: "OTP_UNAVAILABLE" });
      }
    }
  );

  app.post(
    "/auth/login/otp",
    {
      config: { rateLimit: OTP_VERIFY_RATE_LIMIT },
      schema: { body: otpLoginSchema() },
    },
    async (request, reply) => {
      try {
        if (!app.authFeatures?.hasAuthOtpChallengeTable) {
          return sendFailure(reply, { status: 503, error: "OTP_UNAVAILABLE" });
        }

        if (!isTrustedOrigin(request, allowedOrigins)) {
          return sendFailure(reply, { status: 403, error: "ORIGIN_FORBIDDEN" });
        }

        const body = request.body || {};
        const tenantRef = readTenantValue(body);
        const login = readLoginValue(body);
        const password = normalizeString(body.password);
        const challengeId = readChallengeId(body);
        const otpCode = readOtpValue(body);

        if (!challengeId || !/^[0-9a-fA-F-]{36}$/.test(challengeId) || !/^\d{6}$/.test(otpCode)) {
          return sendFailure(reply, { status: 400, error: "BAD_REQUEST" });
        }

        const otpConfig = getOtpConfig(app);
        if (!otpConfig.pepper) {
          return sendFailure(reply, { status: 503, error: "OTP_UNAVAILABLE" });
        }

        const primary = await verifyPrimaryFactor(app, { tenantRef, login, password });
        if (!primary.ok) {
          return sendFailure(reply, primary);
        }

        const { tenant, identity } = primary;

        const challengeResult = await app.db.query(
          `
          SELECT id, otp_hash, attempt_count, max_attempt_count, expires_at, is_consumed
          FROM eip_auth.auth_otp_challenge
          WHERE id = $1::uuid
            AND tenant_id = $2::uuid
            AND identity_id = $3::uuid
          LIMIT 1
          `,
          [challengeId, tenant.tenant_id, identity.id]
        );

        if (challengeResult.rowCount === 0) {
          return sendFailure(reply, { status: 401, error: "OTP_INVALID" });
        }

        const challenge = challengeResult.rows[0];
        const expiresAt = new Date(challenge.expires_at);
        const attempts = Number.parseInt(String(challenge.attempt_count || 0), 10) || 0;
        const maxAttempts = Number.parseInt(String(challenge.max_attempt_count || otpConfig.maxAttempts), 10) || otpConfig.maxAttempts;

        if (challenge.is_consumed || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
          return sendFailure(reply, { status: 401, error: "OTP_EXPIRED" });
        }

        if (attempts >= maxAttempts) {
          await app.db.query(
            `
            UPDATE eip_auth.auth_otp_challenge
            SET is_consumed = true,
                consumed_at = now(),
                attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object('blocked_reason', 'max_attempts')
            WHERE id = $1::uuid
              AND tenant_id = $2::uuid
              AND identity_id = $3::uuid
            `,
            [challengeId, tenant.tenant_id, identity.id]
          );
          return sendFailure(reply, { status: 401, error: "OTP_INVALID" });
        }

        const expectedHash = sha256Hex(`${otpCode}:${challengeId}:${otpConfig.pepper}`);
        if (!challenge.otp_hash || !timingSafeEqual(String(challenge.otp_hash), expectedHash)) {
          await app.db.query(
            `
            UPDATE eip_auth.auth_otp_challenge
            SET attempt_count = attempt_count + 1,
                attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object('last_failed_at', now())
            WHERE id = $1::uuid
              AND tenant_id = $2::uuid
              AND identity_id = $3::uuid
            `,
            [challengeId, tenant.tenant_id, identity.id]
          );
          return sendFailure(reply, { status: 401, error: "OTP_INVALID" });
        }

        await app.db.query(
          `
          UPDATE eip_auth.auth_otp_challenge
          SET is_consumed = true,
              consumed_at = now(),
              attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object('consumed_at', now())
          WHERE id = $1::uuid
            AND tenant_id = $2::uuid
            AND identity_id = $3::uuid
          `,
          [challengeId, tenant.tenant_id, identity.id]
        );

        const deviceContext = await resolveDeviceContext(app, request, {
          tenantId: tenant.tenant_id,
          identityId: identity.id,
          trustStateOnCreate: "trusted",
        });

        if (deviceContext.deviceRow?.trust_state === "revoked") {
          return sendFailure(reply, { status: 401, error: "DEVICE_REVOKED" });
        }

        const created = await app.createSession({
          tenantId: tenant.tenant_id,
          identityId: identity.id,
          deviceId: deviceContext.deviceRow?.id || null,
          assurance: "otp",
          realm: AUTH_REALM,
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        });

        app.issueAuthCookies(reply, {
          ...created,
          did: deviceContext.deviceToken,
          deviceExpiresAt: deviceContext.deviceExpiresAt,
        });

        return reply.send({
          ok: true,
          tenant_id: tenant.tenant_id,
          identity_id: identity.id,
          realm: AUTH_REALM,
          assurance: "otp",
        });
      } catch (error) {
        request.log.error({ event: "otp_login_error", message: error?.message || String(error) });
        return sendFailure(reply, { status: 500, error: "AUTH_UNAVAILABLE" });
      }
    }
  );

  app.post(
    "/auth/totp/bootstrap",
    {
      config: { rateLimit: TOTP_BOOTSTRAP_RATE_LIMIT },
      schema: { body: authBodySchema() },
    },
    async (request, reply) => {
      try {
        if (!isTrustedOrigin(request, allowedOrigins)) {
          return sendFailure(reply, { status: 403, error: "ORIGIN_FORBIDDEN" });
        }

        const body = request.body || {};
        const tenantRef = readTenantValue(body);
        const login = readLoginValue(body);
        const password = normalizeString(body.password);

        const primary = await verifyPrimaryFactor(app, { tenantRef, login, password });
        if (!primary.ok) {
          return sendFailure(reply, primary);
        }

        const key = getTotpSecretKey(app);
        if (!key) {
          return sendFailure(reply, { status: 503, error: "TOTP_UNAVAILABLE" });
        }

        const { tenant, identity } = primary;
        const secret = generateSecret();
        const issuer = getTotpIssuer(app);
        const label = `${issuer}:${login}`;
        const uri = generateURI({
          issuer,
          label: login,
          secret,
          period: TOTP_PERIOD_SECONDS,
          digits: TOTP_DIGITS,
        });
        const encryptedSecret = encryptTotpSecret(secret, key);

        const existingTotp = await app.loadTotpCredential(tenant.tenant_id, identity.id);
        if (existingTotp?.id) {
          await app.db.query(
            `
            UPDATE eip_auth.auth_credential
            SET secret_hash = $3,
                algorithm = 'totp',
                meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('issuer', $4::text, 'label', $5::text, 'updated_at', now()),
                valid_from = now(),
                valid_to = NULL,
                is_revoked = false
            WHERE id = $1::uuid
              AND tenant_id = $2::uuid
            `,
            [existingTotp.id, tenant.tenant_id, encryptedSecret, issuer, label]
          );
        } else {
          await app.db.query(
            `
            INSERT INTO eip_auth.auth_credential
              (id, tenant_id, identity_id, credential_type, secret_hash, algorithm, meta, valid_from, valid_to, is_revoked, created_at)
            VALUES
              ($1::uuid, $2::uuid, $3::uuid, 'totp', $4, 'totp', $5::jsonb, now(), NULL, false, now())
            `,
            [
              crypto.randomUUID(),
              tenant.tenant_id,
              identity.id,
              encryptedSecret,
              JSON.stringify({ issuer, label, enrolled_at: new Date().toISOString() }),
            ]
          );
        }

        return reply.send({
          ok: true,
          issuer,
          label,
          uri,
          secret_preview: `${secret.slice(0, 4)}****${secret.slice(-4)}`,
        });
      } catch (error) {
        request.log.error({ event: "totp_bootstrap_error", message: error?.message || String(error) });
        return sendFailure(reply, { status: 500, error: "TOTP_UNAVAILABLE" });
      }
    }
  );

  app.post(
    "/auth/login/totp",
    {
      config: { rateLimit: TOTP_LOGIN_RATE_LIMIT },
      schema: { body: totpLoginSchema() },
    },
    async (request, reply) => {
      try {
        if (!isTrustedOrigin(request, allowedOrigins)) {
          return sendFailure(reply, { status: 403, error: "ORIGIN_FORBIDDEN" });
        }

        const body = request.body || {};
        const tenantRef = readTenantValue(body);
        const login = readLoginValue(body);
        const password = normalizeString(body.password);
        const token = readOtpValue({ token: body.token ?? body.totp });

        if (!/^\d{6}$/.test(token)) {
          return sendFailure(reply, { status: 400, error: "BAD_REQUEST" });
        }

        const primary = await verifyPrimaryFactor(app, { tenantRef, login, password });
        if (!primary.ok) {
          return sendFailure(reply, primary);
        }

        const key = getTotpSecretKey(app);
        if (!key) {
          return sendFailure(reply, { status: 503, error: "TOTP_UNAVAILABLE" });
        }

        const { tenant, identity } = primary;
        const totpCredential = await app.loadTotpCredential(tenant.tenant_id, identity.id);
        if (!totpCredential) {
          return sendFailure(reply, { status: 404, error: "TOTP_NOT_FOUND" });
        }

        const secret = decryptTotpSecret(totpCredential.secret_hash, key);
        if (!secret) {
          return sendFailure(reply, { status: 500, error: "TOTP_SECRET_INVALID" });
        }

        const result = await verify({
          secret,
          token,
          period: TOTP_PERIOD_SECONDS,
          window: TOTP_WINDOW,
          digits: TOTP_DIGITS,
        });
        if (!result?.valid) {
          return sendFailure(reply, { status: 401, error: "INVALID_TOTP" });
        }

        const deviceContext = await resolveDeviceContext(app, request, {
          tenantId: tenant.tenant_id,
          identityId: identity.id,
          trustStateOnCreate: "trusted",
        });

        if (deviceContext.deviceRow?.trust_state === "revoked") {
          return sendFailure(reply, { status: 401, error: "DEVICE_REVOKED" });
        }

        const created = await app.createSession({
          tenantId: tenant.tenant_id,
          identityId: identity.id,
          deviceId: deviceContext.deviceRow?.id || null,
          assurance: "totp",
          realm: AUTH_REALM,
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        });

        app.issueAuthCookies(reply, {
          ...created,
          did: deviceContext.deviceToken,
          deviceExpiresAt: deviceContext.deviceExpiresAt,
        });

        return reply.send({
          ok: true,
          tenant_id: tenant.tenant_id,
          identity_id: identity.id,
          realm: AUTH_REALM,
          assurance: "totp",
        });
      } catch (error) {
        request.log.error({ event: "totp_login_error", message: error?.message || String(error) });
        return sendFailure(reply, { status: 500, error: "AUTH_UNAVAILABLE" });
      }
    }
  );

  app.get("/auth/whoami", async (request, reply) => {
    const sessionResult = await app.requireSession(request, { realm: AUTH_REALM });
    if (!sessionResult.ok) {
      return sendFailure(reply, sessionResult);
    }

    return reply.send(minimalAuthContext(sessionResult.session));
  });

  app.post("/auth/logout", async (request, reply) => {
    const sessionResult = await app.requireSession(request, { realm: AUTH_REALM });
    if (!sessionResult.ok) {
      return sendFailure(reply, sessionResult);
    }

    const csrfResult = await app.requireCsrf(request);
    if (!csrfResult.ok) {
      return sendFailure(reply, csrfResult);
    }

    await app.revokeSession(sessionResult.session.id, sessionResult.session.tenant_id);
    app.clearAuthCookies(reply);

    return reply.send({ ok: true });
  });
}
