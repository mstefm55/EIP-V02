import crypto from "node:crypto";
import pg from "pg";
import { evaluatePasswordStrength, hashPassword } from "../src/auth/password.js";

const DEFAULT_BOOTSTRAP_PERMISSION_CODES = [
  "PROCESS_DEF_READ",
  "CRM_PROCESS_DEF_READ",
  "PROCESS_DEF_WRITE",
  "CRM_PROCESS_DEF_WRITE",
  "PROCESS_INSTANCE_READ",
  "PROCESS_INSTANCE_WRITE",
];

const OWNER_ADMIN_BOOTSTRAP_RECORDS = Object.freeze([
  Object.freeze({
    objectType: "owner_admin.dashboard",
    code: "dash_platform_posture",
    title: "Platform Posture",
    status: "active",
    attrs: {
      module: "dashboard",
      owner: "Owner Admin",
      metric: "Healthy",
      summary: "Overall tenant and process runtime posture is stable.",
      notes: "Review daily before publishing governance updates.",
      is_active: true,
    },
  }),
  Object.freeze({
    objectType: "owner_admin.tenant_requests",
    code: "treq_pending_queue",
    title: "Pending Onboarding Queue",
    status: "pending",
    attrs: {
      module: "tenant_requests",
      owner: "Onboarding Team",
      applicant_name: "Arcadia Retail Ltd",
      applicant_email: "onboarding@arcadia.example",
      applicant_country: "Mauritius",
      onboarding_stage: "Due Diligence",
      summary: "Initial KYC documents received and under review.",
      is_active: true,
    },
  }),
  Object.freeze({
    objectType: "owner_admin.connections",
    code: "conn_samara_web",
    title: "Samara Web",
    status: "active",
    attrs: {
      module: "connections",
      owner: "Gateway Operations",
      connection_kind: "ecommerce",
      frontend_url: "http://localhost:5174",
      portal_url: "https://portal.tenant-site.com",
      direction: "both",
      environment: "sandbox",
      gateway_route: "s-conn",
      api_key_label: "samara-web-primary",
      summary: "Primary gateway profile for tenant storefront traffic.",
      is_active: true,
    },
  }),
  Object.freeze({
    objectType: "owner_admin.tasks_follow_up",
    code: "task_security_review",
    title: "Security Review Follow-up",
    status: "in_progress",
    attrs: {
      module: "tasks_follow_up",
      owner: "Security",
      priority: "High",
      due_date: "2026-04-15",
      action_owner: "Owner Admin",
      summary: "Finalize policy exceptions for elevated access roles.",
      is_active: true,
    },
  }),
  Object.freeze({
    objectType: "owner_admin.users_roles",
    code: "user_owner_admin",
    title: "Owner Admin Primary",
    status: "active",
    attrs: {
      module: "users_roles",
      owner: "Access Control",
      principal_login: "v2.workbench.admin",
      role_code: "OWNER_ADMIN",
      access_scope: "platform",
      last_seen_at: new Date().toISOString(),
      summary: "Primary owner-admin identity used for governance actions.",
      is_active: true,
    },
  }),
  Object.freeze({
    objectType: "owner_admin.portfolios",
    code: "port_core_platform",
    title: "Core Platform Portfolio",
    status: "active",
    attrs: {
      module: "portfolios",
      owner: "Platform PMO",
      portfolio_domain: "Core",
      delivery_owner: "Architecture Team",
      summary: "Kernel and engine modernization roadmap.",
      is_active: true,
    },
  }),
  Object.freeze({
    objectType: "owner_admin.templates",
    code: "tmpl_owner_shell",
    title: "Owner Shell Template",
    status: "published",
    attrs: {
      module: "templates",
      owner: "Platform Team",
      template_scope: "owner_admin",
      template_version: "v2.1",
      summary: "Baseline shell profile used for owner-admin surfaces.",
      is_active: true,
    },
  }),
  Object.freeze({
    objectType: "owner_admin.security",
    code: "sec_session_controls",
    title: "Session Control Policy",
    status: "active",
    attrs: {
      module: "security",
      owner: "Security",
      control_code: "SEC-SESSION-001",
      severity: "High",
      evidence_ref: "AUTH_SESSION_POLICY",
      summary: "Idle timeout + CSRF + trusted-device checks enabled.",
      is_active: true,
    },
  }),
  Object.freeze({
    objectType: "owner_admin.audit",
    code: "aud_profile_publish",
    title: "Shell Profile Publish Event",
    status: "recorded",
    attrs: {
      module: "audit",
      owner: "Audit",
      event_type: "SHELL_PROFILE_PUBLISH",
      actor: "owner-admin",
      occurred_at: new Date().toISOString(),
      summary: "Latest owner-admin shell profile was published successfully.",
      is_active: true,
    },
  }),
  Object.freeze({
    objectType: "owner_admin.data_explorer",
    code: "data_process_snapshot",
    title: "Process Snapshot Dataset",
    status: "active",
    attrs: {
      module: "data_explorer",
      owner: "Data Governance",
      data_domain: "process",
      sensitivity: "restricted",
      refreshed_at: new Date().toISOString(),
      summary: "Current process-definition and lifecycle snapshots.",
      is_active: true,
    },
  }),
  Object.freeze({
    objectType: "owner_admin.integrations",
    code: "intg_email_gateway",
    title: "Email Gateway",
    status: "active",
    attrs: {
      module: "integrations",
      owner: "Integrations",
      provider: "SMTP",
      direction: "outbound",
      endpoint: "smtp://configured",
      summary: "OTP and workflow notifications delivery integration.",
      is_active: true,
    },
  }),
  Object.freeze({
    objectType: "owner_admin.reports",
    code: "rpt_daily_operations",
    title: "Daily Operations Report",
    status: "generated",
    attrs: {
      module: "reports",
      owner: "Owner Admin",
      cadence: "daily",
      last_run_at: new Date().toISOString(),
      report_scope: "platform",
      summary: "Daily summary of onboarding, process, and security posture.",
      is_active: true,
    },
  }),
  Object.freeze({
    objectType: "owner_admin.settings",
    code: "set_shell_profile",
    title: "Shell Profile Selection",
    status: "active",
    attrs: {
      module: "settings",
      owner: "Owner Admin",
      setting_scope: "platform",
      setting_value: "EIP_CORE_STANDARD",
      summary: "Active owner-admin shell profile for runtime rendering.",
      is_active: true,
    },
  }),
]);

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
        to_regclass('eip_auth.auth_session')::text AS auth_session,
        to_regclass('eip_core.service_object')::text AS service_object
    `);
    const check = required.rows[0];
    const missing = Object.entries(check)
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

    for (const record of OWNER_ADMIN_BOOTSTRAP_RECORDS) {
      await client.query(
        `
        INSERT INTO eip_core.service_object
          (tenant_id, object_type, status, code, title, attrs)
        VALUES
          ($1::uuid, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (tenant_id, code) DO UPDATE
        SET object_type = EXCLUDED.object_type,
            status = EXCLUDED.status,
            title = EXCLUDED.title,
            attrs = EXCLUDED.attrs,
            updated_at = now()
        `,
        [
          tenantId,
          record.objectType,
          record.status,
          record.code,
          record.title,
          JSON.stringify(record.attrs),
        ]
      );
    }

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
