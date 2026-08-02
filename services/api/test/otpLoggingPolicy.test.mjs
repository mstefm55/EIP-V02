import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Writable } from "node:stream";
import Fastify from "fastify";

import {
  buildOtpChallengeResponse,
  canLogDevelopmentOtp,
  getRuntimeMode,
  logDevelopmentOtpIfAllowed,
} from "../src/auth/otpLogging.js";
import { hashPassword } from "../src/auth/password.js";
import authRoutes from "../src/routes/auth.js";
import { buildRuntimeConfig } from "../src/server.js";

function captureLogger() {
  const entries = [];
  return {
    entries,
    logger: {
      info(entry) {
        entries.push(entry);
      },
    },
  };
}

function createLogCaptureStream() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk).toString("utf8"));
      callback();
    },
  });
  return {
    stream,
    text() {
      return chunks.join("");
    },
  };
}

function collectHeaderText(headers = {}) {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(",") : String(value)}`)
    .join("\n");
}

async function createOtpRouteHarness({ runtimeMode = "production", logDevOtp = true, deliveryThrows = false } = {}) {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const identityId = "22222222-2222-4222-8222-222222222222";
  const password = "RouteTestPassw0rd!";
  const credential = {
    secret_hash: await hashPassword(password),
    algorithm: "argon2id",
  };
  const deliveryCalls = [];
  const dbQueries = [];
  const logCapture = createLogCaptureStream();
  const app = Fastify({
    logger: {
      level: "info",
      stream: logCapture.stream,
    },
  });

  app.decorate("config", {
    NODE_ENV: runtimeMode,
    runtimeMode,
    runtimeModeExplicit: true,
    LOG_DEV_OTP: logDevOtp,
    AUTH_OTP_PEPPER: "route-test-otp-pepper",
    AUTH_OTP_TTL_SEC: 600,
    AUTH_OTP_MAX_ATTEMPTS: 6,
    AUTH_OTP_RECENT_WINDOW_MIN: 10,
    AUTH_LOGIN_FAILURE_THRESHOLD: 8,
    AUTH_LOGIN_LOCK_MIN: 15,
    corsOrigin: ["http://localhost:5174"],
    SMTP_HOST: "smtp.example.test",
    SMTP_USER: "smtp-user",
    SMTP_PASS: "smtp-pass",
  });
  app.decorate("authFeatures", { hasAuthOtpChallengeTable: true });
  app.decorate("loadTenant", async (tenantRef) => {
    assert.equal(tenantRef, "v2seed");
    return { tenant_id: tenantId, code: "v2seed" };
  });
  app.decorate("loadIdentity", async (loadedTenantId, login) => {
    assert.equal(loadedTenantId, tenantId);
    assert.equal(login, "otp.user@example.test");
    return {
      id: identityId,
      is_active: true,
      is_locked: false,
      attrs: { email: "otp.user@example.test", permissions: [] },
    };
  });
  app.decorate("loadPasswordCredential", async (loadedTenantId, loadedIdentityId) => {
    assert.equal(loadedTenantId, tenantId);
    assert.equal(loadedIdentityId, identityId);
    return credential;
  });
  app.decorate("otpDelivery", {
    async sendEmail(_app, recipient, subject, text, html) {
      const otp = String(text).match(/\b\d{6}\b/)?.[0] || "";
      deliveryCalls.push({ recipient, subject, text, html, otp });
      if (deliveryThrows) {
        throw new Error("controlled delivery failure");
      }
    },
  });
  app.decorate("db", {
    async query(sql, params) {
      dbQueries.push({ sql, params });
      if (sql.includes("SELECT count(*)::int AS recent_count")) {
        return { rowCount: 1, rows: [{ recent_count: 0 }] };
      }
      if (sql.includes("UPDATE eip_auth.auth_identity")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("INSERT INTO eip_auth.auth_otp_challenge")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("UPDATE eip_auth.auth_otp_challenge")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected OTP route query: ${sql}`);
    },
  });

  await app.register(authRoutes, { prefix: "/api/eip" });

  return {
    app,
    password,
    deliveryCalls,
    dbQueries,
    logCapture,
    async close() {
      await app.close();
    },
  };
}

describe("OTP development logging policy", () => {
  const policyCases = [
    ["production + LOG_DEV_OTP=true", { NODE_ENV: "production", LOG_DEV_OTP: true }, false],
    ["production + LOG_DEV_OTP=false", { NODE_ENV: "production", LOG_DEV_OTP: false }, false],
    ["prod + LOG_DEV_OTP=true", { NODE_ENV: "prod", LOG_DEV_OTP: true }, false],
    ["Production + LOG_DEV_OTP=true", { NODE_ENV: "Production", LOG_DEV_OTP: true }, false],
    ["whitespace production + LOG_DEV_OTP=true", { NODE_ENV: " production ", LOG_DEV_OTP: true }, false],
    ["development + LOG_DEV_OTP=true", { NODE_ENV: "development", LOG_DEV_OTP: true }, true],
    ["dev + LOG_DEV_OTP=true", { NODE_ENV: "dev", LOG_DEV_OTP: true }, true],
    ["local + LOG_DEV_OTP=true", { NODE_ENV: "local", LOG_DEV_OTP: true }, true],
    ["test + LOG_DEV_OTP=true", { NODE_ENV: "test", LOG_DEV_OTP: true }, true],
    ["development + LOG_DEV_OTP=false", { NODE_ENV: "development", LOG_DEV_OTP: false }, false],
    ["missing mode + LOG_DEV_OTP=true", { LOG_DEV_OTP: true }, false],
    ["null mode + LOG_DEV_OTP=true", { NODE_ENV: null, LOG_DEV_OTP: true }, false],
    ["empty mode + LOG_DEV_OTP=true", { NODE_ENV: "", LOG_DEV_OTP: true }, false],
    ["whitespace-only mode + LOG_DEV_OTP=true", { NODE_ENV: "   ", LOG_DEV_OTP: true }, false],
    ["prd + LOG_DEV_OTP=true", { NODE_ENV: "prd", LOG_DEV_OTP: true }, false],
    ["live + LOG_DEV_OTP=true", { NODE_ENV: "live", LOG_DEV_OTP: true }, false],
    ["staging + LOG_DEV_OTP=true", { NODE_ENV: "staging", LOG_DEV_OTP: true }, false],
    ["preview + LOG_DEV_OTP=true", { NODE_ENV: "preview", LOG_DEV_OTP: true }, false],
    ["qa + LOG_DEV_OTP=true", { NODE_ENV: "qa", LOG_DEV_OTP: true }, false],
    ["unknown + LOG_DEV_OTP=true", { NODE_ENV: "unknown", LOG_DEV_OTP: true }, false],
    ["missing LOG_DEV_OTP", { NODE_ENV: "development" }, false],
  ];

  for (const [name, config, expected] of policyCases) {
    it(`returns ${expected} for ${name}`, () => {
      const captured = captureLogger();
      const logged = logDevelopmentOtpIfAllowed({
        config,
        logger: captured.logger,
        challengeId: "challenge-1",
        otp: "123456",
        recipient: "user@example.test",
      });

      assert.equal(canLogDevelopmentOtp(config), expected);
      assert.equal(logged, expected);
      assert.equal(captured.entries.length, expected ? 1 : 0);
      if (expected) {
        assert.equal(captured.entries[0].otp, "123456");
      }
    });
  }

  it("normalizes the runtime mode used by centralized API config", () => {
    const config = buildRuntimeConfig({ NODE_ENV: "prod", LOG_DEV_OTP: true });

    assert.equal(config.NODE_ENV, "production");
    assert.equal(config.runtimeMode, "production");
    assert.equal(config.runtimeModeExplicit, true);
    assert.equal(getRuntimeMode(config), "production");
    assert.equal(canLogDevelopmentOtp(config), false);
  });

  it("fails closed when centralized API config defaults runtime mode without explicit NODE_ENV", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      const config = buildRuntimeConfig({ LOG_DEV_OTP: true });

      assert.equal(config.NODE_ENV, "development");
      assert.equal(config.runtimeMode, "development");
      assert.equal(config.runtimeModeExplicit, false);
      assert.equal(canLogDevelopmentOtp(config), false);
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });

  it("uses the centralized boolean parsing convention for LOG_DEV_OTP", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalLogDevOtp = process.env.LOG_DEV_OTP;
    try {
      process.env.NODE_ENV = "development";
      process.env.LOG_DEV_OTP = "yes";
      const enabled = buildRuntimeConfig();
      assert.equal(enabled.LOG_DEV_OTP, true);
      assert.equal(canLogDevelopmentOtp(enabled), true);

      process.env.LOG_DEV_OTP = "false";
      const disabled = buildRuntimeConfig();
      assert.equal(disabled.LOG_DEV_OTP, false);
      assert.equal(canLogDevelopmentOtp(disabled), false);
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalLogDevOtp === undefined) {
        delete process.env.LOG_DEV_OTP;
      } else {
        process.env.LOG_DEV_OTP = originalLogDevOtp;
      }
    }
  });

  it("does not expose OTP values in OTP request response bodies", () => {
    const response = buildOtpChallengeResponse({
      challengeId: "11111111-1111-4111-8111-111111111111",
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const serialized = JSON.stringify(response);
    assert.equal(response.ok, true);
    assert.equal(response.challenge_id, "11111111-1111-4111-8111-111111111111");
    assert.doesNotMatch(serialized, /123456/);
    assert.doesNotMatch(serialized, /otp/i);
  });

  it("route-level production OTP request never logs or returns the generated OTP", async () => {
    const harness = await createOtpRouteHarness({ runtimeMode: "production", logDevOtp: true });
    try {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/eip/auth/request-otp",
        headers: { origin: "http://localhost:5174" },
        payload: {
          tenantCode: "v2seed",
          login: "otp.user@example.test",
          password: harness.password,
        },
      });

      assert.equal(response.statusCode, 200);
      assert.equal(harness.deliveryCalls.length, 1);
      const actualOtp = harness.deliveryCalls[0].otp;
      assert.match(actualOtp, /^\d{6}$/);

      const bodyText = response.body;
      const body = JSON.parse(bodyText);
      assert.deepEqual(Object.keys(body).sort(), ["challenge_id", "expires_at", "ok"]);
      assert.equal(body.ok, true);
      assert.doesNotMatch(bodyText, new RegExp(actualOtp));
      assert.doesNotMatch(collectHeaderText(response.headers), new RegExp(actualOtp));
      assert.doesNotMatch(harness.logCapture.text(), new RegExp(actualOtp));
    } finally {
      await harness.close();
    }
  });

  it("route-level production OTP delivery failure does not leak the generated OTP", async () => {
    const harness = await createOtpRouteHarness({
      runtimeMode: "production",
      logDevOtp: true,
      deliveryThrows: true,
    });
    try {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/eip/auth/request-otp",
        headers: { origin: "http://localhost:5174" },
        payload: {
          tenantCode: "v2seed",
          login: "otp.user@example.test",
          password: harness.password,
        },
      });

      assert.equal(response.statusCode, 503);
      assert.equal(harness.deliveryCalls.length, 1);
      const actualOtp = harness.deliveryCalls[0].otp;
      assert.match(actualOtp, /^\d{6}$/);
      assert.doesNotMatch(response.body, new RegExp(actualOtp));
      assert.doesNotMatch(collectHeaderText(response.headers), new RegExp(actualOtp));
      assert.doesNotMatch(harness.logCapture.text(), new RegExp(actualOtp));
      assert.doesNotMatch(String(response.statusMessage || ""), new RegExp(actualOtp));
    } finally {
      await harness.close();
    }
  });
});
