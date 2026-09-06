import crypto from "node:crypto";
import pg from "pg";
import { evaluatePasswordStrength, hashPassword } from "../src/auth/password.js";

const DEFAULT_BOOTSTRAP_PERMISSION_CODES = [
  "OWNER_ADMIN_CONSOLE_READ",
  "OWNER_ADMIN_ACCESS_READ",
  "OWNER_ADMIN_SECURITY_READ",
  "OWNER_ADMIN_SETTINGS_READ",
  "PROCESS_DEF_READ",
  "CRM_PROCESS_DEF_READ",
  "PROCESS_DEF_WRITE",
  "CRM_PROCESS_DEF_WRITE",
  "PROCESS_INSTANCE_READ",
  "PROCESS_INSTANCE_WRITE",
];

function pick(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalize(value) {
  return String(value ?? "").trim();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalize(value).toLowerCase());
}

function parsePermissionCodes(value) {
  const raw = normalize(value);
  const source = raw.length > 0 ? raw.split(",") : DEFAULT_BOOTSTRAP_PERMISSION_CODES;
  const seen = new Set();
  const output = [];
  for (const candidate of source) {
    const code = normalize(candidate).toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    output.push(code);
  }
  return output;
}

function assertUuid(value, label) {
  const raw = normalize(value);
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!re.test(raw)) {
    throw new Error(`${label} must be a UUID`);
  }
  return raw;
}

function resolveDbConfig() {
  return {
    host: pick(process.env.DATABASE_HOST, process.env.DB_HOST, process.env.PGHOST, "localhost"),
    port: parseInteger(pick(process.env.DATABASE_PORT, process.env.DB_PORT, process.env.PGPORT), 5432),
    user: pick(process.env.DATABASE_USER, process.env.DB_USER, process.env.PGUSER, "postgres"),
    password: pick(process.env.DATABASE_PASSWORD, process.env.DB_PASSWORD, process.env.PGPASSWORD, ""),
    database: pick(
      process.env.DATABASE_NAME,
      process.env.DB_DATABASE,
      process.env.DATABASE,
      process.env.PGDATABASE,
      process.env.V2_DATABASE_NAME,
      "eip_V2"
    ),
  };
}

async function main() {
  const config = resolveDbConfig();
  const tenantId = assertUuid(
    pick(process.env.V2_BOOTSTRAP_TENANT_ID, "11111111-1111-4111-8111-111111111111"),
    "V2_BOOTSTRAP_TENANT_ID"
  );
  const tenantCode = normalize(pick(process.env.V2_BOOTSTRAP_TENANT_CODE, "v2seed"));
  const tenantName = normalize(pick(process.env.V2_BOOTSTRAP_TENANT_NAME, "V2 Seed Tenant"));
  const login = normalize(pick(process.env.V2_BOOTSTRAP_LOGIN, "v2.admin"));
  const explicitEmail = normalize(process.env.V2_BOOTSTRAP_EMAIL);
  const fallbackEmail = normalize(
    pick(process.env.V2_BOOTSTRAP_EMAIL_DEFAULT, process.env.SMTP_USER, "")
  );
  const emailDomain = normalize(pick(process.env.V2_BOOTSTRAP_EMAIL_DOMAIN, "eip.local")) || "eip.local";
  const password = normalize(process.env.V2_BOOTSTRAP_PASSWORD);
  const loginType = normalize(pick(process.env.V2_BOOTSTRAP_LOGIN_TYPE, "username")).toLowerCase();
  const permissionCodes = parsePermissionCodes(process.env.V2_BOOTSTRAP_PERMISSION_CODES);
  const derivedEmailLocal = (login || "user")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 48) || "user";
  const resolvedEmail = isEmail(explicitEmail)
    ? explicitEmail.toLowerCase()
    : isEmail(login)
      ? login.toLowerCase()
      : isEmail(fallbackEmail)
        ? fallbackEmail.toLowerCase()
        : `${derivedEmailLocal}@${emailDomain.toLowerCase()}`;

  if (!tenantCode || !tenantName || !login) {
    throw new Error("V2 bootstrap tenantCode, tenantName, and login must be non-empty");
  }
  if (!password) {
    throw new Error("V2_BOOTSTRAP_PASSWORD is required");
  }

  const strength = evaluatePasswordStrength(password);
  if (!strength.ok) {
    throw new Error(`V2_BOOTSTRAP_PASSWORD failed policy: ${strength.feedback.join("; ")}`);
  }

  const pool = new pg.Pool(config);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const required = await client.query(`
      SELECT
        to_regclass('kernel.tenants')::text AS kernel_tenants,
        to_regclass('eip_auth.auth_identity')::text AS auth_identity,
        to_regclass('eip_auth.auth_credential')::text AS auth_credential,
        to_regclass('eip_auth.auth_session')::text AS auth_session
    `);
    const missing = Object.entries(required.rows[0] || {})
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length > 0) {
      throw new Error(`Missing required tables before seed: ${missing.join(", ")}`);
    }

    await client.query(
      `
      INSERT INTO kernel.tenants
        (tenant_id, tenant_code, tenant_name, tenancy_mode, tenant_status, created_at, updated_at)
      VALUES
        ($1::uuid, $2, $3, 'POOL', 'active', now(), now())
      ON CONFLICT (tenant_id) DO UPDATE
      SET tenant_code = EXCLUDED.tenant_code,
          tenant_name = EXCLUDED.tenant_name,
          tenancy_mode = EXCLUDED.tenancy_mode,
          tenant_status = EXCLUDED.tenant_status,
          updated_at = now()
      `,
      [tenantId, tenantCode, tenantName]
    );

    let identityId;
    const identityLookup = await client.query(
      `
      SELECT id
      FROM eip_auth.auth_identity
      WHERE tenant_id = $1::uuid
        AND lower(login) = lower($2)
      LIMIT 1
      `,
      [tenantId, login]
    );

    if (identityLookup.rowCount === 1) {
      identityId = identityLookup.rows[0].id;
      await client.query(
        `
        UPDATE eip_auth.auth_identity
        SET login_type = $3,
            is_active = true,
            is_locked = false,
            attrs = (COALESCE(attrs, '{}'::jsonb)
              - 'failed_login_count'
              - 'last_failed_login_at'
              - 'login_lock_until')
              || jsonb_build_object(
                'permissions', to_jsonb($4::text[]),
                'email', $5::text
              ),
            updated_at = now()
        WHERE tenant_id = $1::uuid
          AND id = $2::uuid
        `,
        [tenantId, identityId, loginType, permissionCodes, resolvedEmail]
      );
    } else {
      identityId = assertUuid(
        pick(process.env.V2_BOOTSTRAP_IDENTITY_ID, crypto.randomUUID()),
        "V2_BOOTSTRAP_IDENTITY_ID"
      );
      await client.query(
        `
        INSERT INTO eip_auth.auth_identity
          (id, tenant_id, login, login_type, is_active, is_locked, attrs, created_at, updated_at)
        VALUES
          ($1::uuid, $2::uuid, $3, $4, true, false, $5::jsonb, now(), now())
        `,
        [
          identityId,
          tenantId,
          login,
          loginType,
          JSON.stringify({ permissions: permissionCodes, email: resolvedEmail }),
        ]
      );
    }

    await client.query(
      `
      UPDATE eip_auth.auth_credential
      SET is_revoked = true,
          valid_to = COALESCE(valid_to, now())
      WHERE tenant_id = $1::uuid
        AND identity_id = $2::uuid
        AND credential_type = 'password'
        AND is_revoked = false
      `,
      [tenantId, identityId]
    );

    const passwordHash = await hashPassword(password);
    await client.query(
      `
      INSERT INTO eip_auth.auth_credential
        (id, tenant_id, identity_id, credential_type, secret_hash, algorithm, meta, valid_from, valid_to, is_revoked, created_at)
      VALUES
        ($1::uuid, $2::uuid, $3::uuid, 'password', $4, 'argon2id', '{}'::jsonb, now(), NULL, false, now())
      `,
      [crypto.randomUUID(), tenantId, identityId, passwordHash]
    );

    await client.query("COMMIT");
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          database: config.database,
          tenant_id: tenantId,
          tenant_code: tenantCode,
          identity_id: identityId,
          login,
          email: resolvedEmail,
          permission_codes: permissionCodes,
        },
        null,
        2
      )}\n`
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error?.message ?? String(error) }, null, 2)}\n`
  );
  process.exit(1);
});
