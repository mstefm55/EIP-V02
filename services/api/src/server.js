import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { fileURLToPath } from "node:url";
import path from "node:path";

import dbPlugin from "./plugins/db.js";
import authShellPlugin from "./plugins/authShell.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import tenantRequestsPublicRoutes from "./routes/tenant_requests_public.js";
import coreProcessRoutes from "./routes/process/core_process.js";
import uiSurfaceRoutes from "./routes/ui_surface.js";
import ownerAdminModuleRoutes from "./routes/owner_admin_modules.js";
import { advanceInstance, createInstance, findActiveInstance, updateTaskStatus } from "./core/core_process_engine.js";

const DEFAULT_PORT = 4010;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://localhost:5174"];

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

function parseCorsOrigins(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_CORS_ORIGINS;
  if (raw === "*") return true;

  const origins = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : DEFAULT_CORS_ORIGINS;
}

function buildRuntimeConfig(overrides = {}) {
  const env = {
    port: parseInteger(process.env.PORT, DEFAULT_PORT),
    host: process.env.HOST || DEFAULT_HOST,
    logLevel: process.env.LOG_LEVEL || "info",
    trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
    corsOrigin: parseCorsOrigins(process.env.CORS_ORIGIN),
    corsCredentials: parseBoolean(process.env.CORS_CREDENTIALS, true),
    rateLimitMax: parseInteger(process.env.RATE_LIMIT_MAX, 100),
    rateLimitWindow: process.env.RATE_LIMIT_WINDOW || "1 minute",
    databaseUrl: process.env.DATABASE_URL || null,
    databaseSsl: parseBoolean(process.env.DATABASE_SSL ?? process.env.DB_SSL, false),
    databaseSslAllowInvalidCerts: parseBoolean(process.env.DATABASE_SSL_ALLOW_INVALID_CERTS, false),
    databaseMax: parseInteger(process.env.DATABASE_POOL_MAX ?? process.env.PG_POOL_MAX, 10),
    databaseIdleTimeoutMillis: parseInteger(process.env.DATABASE_POOL_IDLE_MS, 30_000),
    databaseHost: process.env.DATABASE_HOST || process.env.DB_HOST || process.env.PGHOST || null,
    databasePort: parseInteger(process.env.DATABASE_PORT || process.env.DB_PORT || process.env.PGPORT, 5432),
    databaseUser: process.env.DATABASE_USER || process.env.DB_USER || process.env.PGUSER || null,
    databasePassword: process.env.DATABASE_PASSWORD || process.env.DB_PASSWORD || process.env.PGPASSWORD || null,
    databaseName:
      process.env.DATABASE_NAME ||
      process.env.DB_DATABASE ||
      process.env.DATABASE ||
      process.env.PGDATABASE ||
      null,
    AUTH_SESSION_PEPPER:
      process.env.AUTH_SESSION_PEPPER ||
      process.env.SESSION_PEPPER ||
      process.env.API_KEY_PEPPER ||
      null,
    AUTH_CSRF_PEPPER:
      process.env.AUTH_CSRF_PEPPER ||
      process.env.CSRF_PEPPER ||
      process.env.API_KEY_PEPPER ||
      null,
    AUTH_OTP_PEPPER:
      process.env.AUTH_OTP_PEPPER ||
      process.env.OTP_PEPPER ||
      process.env.AUTH_SESSION_PEPPER ||
      process.env.SESSION_PEPPER ||
      process.env.API_KEY_PEPPER ||
      null,
    AUTH_TOTP_SECRET_KEY:
      process.env.AUTH_TOTP_SECRET_KEY ||
      process.env.TOTP_SECRET_KEY ||
      null,
    AUTH_TOTP_ISSUER:
      process.env.AUTH_TOTP_ISSUER ||
      process.env.TOTP_ISSUER ||
      "EIP",
    AUTH_COOKIE_SECURE: parseBoolean(process.env.AUTH_COOKIE_SECURE, false),
    AUTH_COOKIE_SAMESITE: process.env.AUTH_COOKIE_SAMESITE || "lax",
    AUTH_COOKIE_PATH: process.env.AUTH_COOKIE_PATH || "/",
    AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN || null,
    AUTH_SESSION_TTL_MIN: parseInteger(process.env.AUTH_SESSION_TTL_MIN, 720),
    AUTH_SESSION_IDLE_TTL_MIN: parseInteger(process.env.AUTH_SESSION_IDLE_TTL_MIN, 120),
    AUTH_SESSION_TOUCH_INTERVAL_SEC: parseInteger(process.env.AUTH_SESSION_TOUCH_INTERVAL_SEC, 300),
    AUTH_SESSION_BIND_USER_AGENT: parseBoolean(process.env.AUTH_SESSION_BIND_USER_AGENT, true),
    AUTH_SESSION_COOKIE_NAME: process.env.AUTH_SESSION_COOKIE_NAME || "sid",
    AUTH_CSRF_COOKIE_NAME: process.env.AUTH_CSRF_COOKIE_NAME || "csrf",
    AUTH_CSRF_REQUIRE_ORIGIN: parseBoolean(process.env.AUTH_CSRF_REQUIRE_ORIGIN, true),
    AUTH_DEVICE_COOKIE_NAME: process.env.AUTH_DEVICE_COOKIE_NAME || "did",
    AUTH_DEVICE_COOKIE_DAYS: parseInteger(process.env.AUTH_DEVICE_COOKIE_DAYS, 90),
    AUTH_DEVICE_PEPPER:
      process.env.AUTH_DEVICE_PEPPER ||
      process.env.AUTH_SESSION_PEPPER ||
      process.env.SESSION_PEPPER ||
      process.env.API_KEY_PEPPER ||
      null,
    AUTH_REQUIRE_TOTP_FOR_PRIVILEGED: parseBoolean(
      process.env.AUTH_REQUIRE_TOTP_FOR_PRIVILEGED,
      false
    ),
    AUTH_OTP_TTL_SEC: parseInteger(process.env.AUTH_OTP_TTL_SEC, 600),
    AUTH_OTP_MAX_ATTEMPTS: parseInteger(process.env.AUTH_OTP_MAX_ATTEMPTS, 6),
    AUTH_LOGIN_FAILURE_THRESHOLD: parseInteger(process.env.AUTH_LOGIN_FAILURE_THRESHOLD, 8),
    AUTH_LOGIN_LOCK_MIN: parseInteger(process.env.AUTH_LOGIN_LOCK_MIN, 15),
    LOG_DEV_OTP: parseBoolean(process.env.LOG_DEV_OTP, false),
    SMTP_HOST: process.env.SMTP_HOST || null,
    SMTP_PORT: parseInteger(process.env.SMTP_PORT, 587),
    SMTP_SECURE: parseBoolean(process.env.SMTP_SECURE, false),
    SMTP_USER: process.env.SMTP_USER || null,
    SMTP_PASS: process.env.SMTP_PASS || null,
    SMTP_FROM: process.env.SMTP_FROM || null,
    REQUEST_ACCESS_TO: process.env.REQUEST_ACCESS_TO || null,
    ENABLE_PUBLIC_DB_HEALTH: parseBoolean(process.env.ENABLE_PUBLIC_DB_HEALTH, false),
  };

  return {
    ...env,
    ...overrides,
    corsOrigin: overrides.corsOrigin ?? env.corsOrigin,
  };
}

async function buildServer(options = {}) {
  const config = buildRuntimeConfig(options.config);

  const app = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: options.bodyLimit ?? 1_048_576,
  });
  app.decorate("config", config);

  await app.register(helmet, { global: true });

  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: config.corsCredentials,
  });

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
  });

  await app.register(dbPlugin);
  await app.register(authShellPlugin);
  app.decorate("coreProcess", { findActiveInstance, advanceInstance, updateTaskStatus, createInstance });
  await app.register(healthRoutes, { prefix: "/api/public" });
  await app.register(tenantRequestsPublicRoutes, { prefix: "/api/public" });
  await app.register(authRoutes, { prefix: "/api/eip" });
  await app.register(uiSurfaceRoutes, { prefix: "/api/public", public: true });
  await app.register(uiSurfaceRoutes, { prefix: "/api/eip" });
  await app.register(ownerAdminModuleRoutes, { prefix: "/api/eip" });
  await app.register(coreProcessRoutes, { prefix: "/api/eip/core" });
  await app.register(coreProcessRoutes, { prefix: "/api/eip" });

  return app;
}

const isDirectRun = path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const app = await buildServer();

  try {
    const config = buildRuntimeConfig();
    await app.listen({
      port: config.port,
      host: config.host,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

export { buildServer };
