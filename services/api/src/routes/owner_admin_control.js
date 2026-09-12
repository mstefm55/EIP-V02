import crypto from "node:crypto";
import { evaluatePasswordStrength, hashPassword } from "../auth/password.js";
import { withTenantTransaction } from "../db/tenantTransaction.js";
import { sendEmail } from "../lib/email.js";

const MAX_LIMIT = 200;
const ACCESS_READ = ["OWNER_ADMIN_ACCESS_READ"];
const ACCESS_WRITE = ["OWNER_ADMIN_ACCESS_WRITE"];
const SECURITY_READ = ["OWNER_ADMIN_SECURITY_READ"];
const SECURITY_WRITE = ["OWNER_ADMIN_SECURITY_WRITE"];
const SETTINGS_READ = ["OWNER_ADMIN_SETTINGS_READ"];
const SETTINGS_WRITE = ["OWNER_ADMIN_SETTINGS_WRITE"];
const AUDIT_READ = ["OWNER_ADMIN_AUDIT_READ"];
const SCHEMA_READ = ["OWNER_ADMIN_SCHEMA_READ"];
const TENANT_REQUEST_READ = ["OWNER_ADMIN_TENANT_REQUEST_READ"];
const TENANT_REQUEST_WRITE = ["OWNER_ADMIN_TENANT_REQUEST_WRITE"];
const STRONG_ASSURANCE = new Set(["otp", "totp"]);
const TENANT_REQUEST_STATUSES = new Set([
  "SUBMITTED",
  "UNDER_REVIEW",
  "BOOTSTRAP_PENDING",
  "ACTIVE",
  "REJECTED",
  "EXPIRED",
]);
const SETTING_STATUSES = new Set(["active", "deprecated", "disabled"]);
const DEVICE_TRUST_STATES = new Set(["trusted", "untrusted", "revoked"]);
const SCHEMA_CATALOG_ALLOWLIST = Object.freeze(["kernel", "tenant", "security", "eip_core", "eip_auth"]);
const BOOTSTRAP_TTL_MS = 48 * 60 * 60 * 1000;

const OWNER_ADMIN_PERMISSION_CODES = Object.freeze([
  "OWNER_ADMIN_CONSOLE_READ",
  "OWNER_ADMIN_ACCESS_READ",
  "OWNER_ADMIN_ACCESS_WRITE",
  "OWNER_ADMIN_SECURITY_READ",
  "OWNER_ADMIN_SECURITY_WRITE",
  "OWNER_ADMIN_SETTINGS_READ",
  "OWNER_ADMIN_SETTINGS_WRITE",
  "OWNER_ADMIN_AUDIT_READ",
  "OWNER_ADMIN_SCHEMA_READ",
  "OWNER_ADMIN_TENANT_REQUEST_READ",
  "OWNER_ADMIN_TENANT_REQUEST_WRITE",
  "OWNER_ADMIN_CONNECTION_READ",
  "OWNER_ADMIN_CONNECTION_WRITE",
  "OWNER_ADMIN_CONNECTION_SECRET_MANAGE",
  "OWNER_ADMIN_CONNECTION_TEST",
  "PROCESS_DEF_READ",
  "CRM_PROCESS_DEF_READ",
  "PROCESS_DEF_WRITE",
  "CRM_PROCESS_DEF_WRITE",
  "PROCESS_INSTANCE_READ",
  "PROCESS_INSTANCE_WRITE",
]);

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function clampLimit(value, fallback = 100) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

function normalizePermissionCodes(values) {
  const input = Array.isArray(values) ? values : [];
  const output = [];
  const seen = new Set();
  for (const raw of input) {
    const code = normalizeText(raw).toUpperCase();
    if (!code || code.length > 100 || !/^[A-Z0-9_.:-]+$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    output.push(code);
  }
  return output;
}

function bootstrapPepper(app) {
  const explicit = normalizeText(app.config?.TENANT_BOOTSTRAP_PEPPER);
  const fallback = normalizeText(app.config?.AUTH_SESSION_PEPPER);
  if (!explicit && !fallback) throw new Error("TENANT_BOOTSTRAP_PEPPER_REQUIRED");
  return explicit || fallback;
}

function hashBootstrapToken(app, token) {
  return crypto
    .createHmac("sha256", bootstrapPepper(app))
    .update(`tenant-bootstrap-v1:${normalizeText(token)}`)
    .digest("hex");
}

function createBootstrapToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function createTenantCode(name) {
  const slug = normalizeText(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "tenant";
  return `${slug}-${crypto.randomBytes(3).toString("hex")}`;
}

function publicFrontendOrigin(app) {
  const source = app.config?.corsOrigin;
  const candidates = Array.isArray(source)
    ? source
    : source && source !== true
      ? String(source).split(",")
      : [];
  for (const candidate of candidates) {
    const value = normalizeText(candidate);
    if (!/^https?:\/\//i.test(value)) continue;
    try {
      return new URL(value).origin;
    } catch {
      // Ignore malformed configured candidates.
    }
  }
  return "";
}

function buildBootstrapLink(app, token) {
  const origin = publicFrontendOrigin(app);
  if (!origin) throw new Error("PUBLIC_FRONTEND_ORIGIN_REQUIRED");
  const url = new URL(origin);
  url.searchParams.set("bootstrap_token", token);
  return url.toString();
}

function maskEmail(value) {
  const email = normalizeEmail(value);
  const at = email.indexOf("@");
  if (at < 1) return email ? "***" : "";
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

async function sendBootstrapEmail(app, requestRow, token, mode) {
  const link = buildBootstrapLink(app, token);
  const resend = mode === "resend";
  const subject = resend ? "Your new EIP setup link" : "Your EIP access request was approved";
  const text = [
    resend
      ? "A new secure setup link has been generated for your EIP account."
      : "Your EIP access request has been approved.",
    "",
    `Organisation: ${requestRow.legal_name}`,
    `Login: ${requestRow.email}`,
    "",
    "Use this one-time link to set your password and activate the organisation:",
    link,
    "",
    "The link expires in 48 hours.",
  ].join("\n");
  const escaped = text.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char]));
  await sendEmail(app, requestRow.email, subject, text, `<pre>${escaped}</pre>`);
}

async function requireRead(app, req, reply, permissions) {
  const result = await app.requirePermission(req, permissions, { realm: "EIP" });
  if (!result.ok) {
    reply.code(result.status).send({ ok: false, error: result.error });
    return null;
  }
  return result.session;
}

async function requireWrite(app, req, reply, permissions, { strong = true } = {}) {
  const session = await requireRead(app, req, reply, permissions);
  if (!session) return null;

  const csrf = await app.requireCsrf(req);
  if (!csrf.ok) {
    reply.code(csrf.status).send({ ok: false, error: csrf.error });
    return null;
  }

  if (strong) {
    const assurance = normalizeText(session.attrs?.assurance).toLowerCase();
    if (!STRONG_ASSURANCE.has(assurance)) {
      reply.code(403).send({ ok: false, error: "STRONG_ASSURANCE_REQUIRED" });
      return null;
    }
  }

  return session;
}

async function writeAudit(app, session, event) {
  const safeAttrs = event.attrs && typeof event.attrs === "object" && !Array.isArray(event.attrs)
    ? event.attrs
    : {};
  await app.db.query(
    `
    INSERT INTO security.audit_event
      (tenant_id, actor_identity_id, event_code, category, severity, outcome,
       subject_kind, subject_id, summary, attrs)
    VALUES
      ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    `,
    [
      session?.tenant_id || null,
      session?.identity_id || null,
      event.code,
      event.category || "admin",
      event.severity || "info",
      event.outcome || "success",
      event.subjectKind || null,
      event.subjectId ? String(event.subjectId) : null,
      event.summary || null,
      JSON.stringify(safeAttrs),
    ]
  );
}

function mapControlUser(row) {
  const attrs = row.attrs && typeof row.attrs === "object" ? row.attrs : {};
  return {
    id: row.id,
    login: row.login,
    email: typeof attrs.email === "string" ? attrs.email : null,
    login_type: row.login_type,
    is_active: row.is_active === true,
    is_locked: row.is_locked === true,
    status: row.is_locked ? "locked" : row.is_active ? "active" : "inactive",
    permissions: normalizePermissionCodes(attrs.permissions),
    permission_count: normalizePermissionCodes(attrs.permissions).length,
    agent_id: row.agent_id || null,
    agent_code: row.agent_code || null,
    agent_name: row.agent_name || null,
    agent_type: row.agent_type || null,
    updated_at: row.updated_at,
  };
}

async function fetchControlUser(app, tenantId, identityId) {
  const result = await app.db.query(
    `
    SELECT
      identity.id,
      identity.login,
      identity.login_type,
      identity.is_active,
      identity.is_locked,
      COALESCE(identity.attrs, '{}'::jsonb) AS attrs,
      identity.updated_at,
      linked.agent_id,
      linked.agent_code,
      linked.agent_name,
      linked.agent_type
    FROM eip_auth.auth_identity AS identity
    LEFT JOIN LATERAL (
      SELECT agent.id AS agent_id, agent.code AS agent_code, agent.name AS agent_name, agent.agent_type
      FROM eip_auth.auth_identity_agent AS link
      JOIN eip_core.agent AS agent
        ON agent.id = link.agent_id
       AND agent.tenant_id = link.tenant_id
      WHERE link.tenant_id = identity.tenant_id
        AND link.identity_id = identity.id
        AND link.is_active = true
        AND agent.is_active = true
      ORDER BY link.is_primary DESC, link.updated_at DESC, link.id
      LIMIT 1
    ) AS linked ON true
    WHERE identity.tenant_id = $1::uuid
      AND identity.id = $2::uuid
    LIMIT 1
    `,
    [tenantId, identityId]
  );
  return result.rows[0] || null;
}

async function setPrimaryAgentLink(client, tenantId, identityId, agentId) {
  await client.query(
    `
    UPDATE eip_auth.auth_identity_agent
    SET is_primary = false,
        is_active = false,
        updated_at = now()
    WHERE tenant_id = $1::uuid
      AND identity_id = $2::uuid
      AND is_active = true
    `,
    [tenantId, identityId]
  );

  if (!agentId) return;

  const agent = await client.query(
    `
    SELECT id
    FROM eip_core.agent
    WHERE tenant_id = $1::uuid
      AND id = $2::uuid
      AND is_active = true
    LIMIT 1
    `,
    [tenantId, agentId]
  );
  if (agent.rowCount !== 1) throw new Error("AGENT_NOT_FOUND");

  await client.query(
    `
    INSERT INTO eip_auth.auth_identity_agent
      (tenant_id, identity_id, agent_id, is_primary, is_active, attrs)
    VALUES
      ($1::uuid, $2::uuid, $3::uuid, true, true, '{}'::jsonb)
    ON CONFLICT (tenant_id, identity_id, agent_id)
    DO UPDATE SET is_primary = true, is_active = true, updated_at = now()
    `,
    [tenantId, identityId, agentId]
  );
}

function mapTenantRequest(row) {
  return {
    id: row.id,
    ref_code: row.ref_code,
    status_code: row.status_code,
    applicant_type: row.applicant_type,
    legal_name: row.legal_name,
    business_reg_no: row.business_reg_no || null,
    personal_id_no: row.personal_id_no || null,
    email: row.email,
    phone: row.phone || null,
    country: row.country,
    timezone: row.timezone,
    tenant_id: row.tenant_id || null,
    tenant_code: row.tenant_code || null,
    bootstrap_expires_at: row.bootstrap_expires_at || null,
    bootstrap_used_at: row.bootstrap_used_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export default async function ownerAdminControlRoutes(app) {
  app.get(
    "/owner-admin/control/users",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 100 } },
        },
      },
    },
    async (req, reply) => {
      const session = await requireRead(app, req, reply, ACCESS_READ);
      if (!session) return;
      const limit = clampLimit(req.query?.limit, 100);
      const result = await app.db.query(
        `
        SELECT
          identity.id,
          identity.login,
          identity.login_type,
          identity.is_active,
          identity.is_locked,
          COALESCE(identity.attrs, '{}'::jsonb) AS attrs,
          identity.updated_at,
          linked.agent_id,
          linked.agent_code,
          linked.agent_name,
          linked.agent_type
        FROM eip_auth.auth_identity AS identity
        LEFT JOIN LATERAL (
          SELECT agent.id AS agent_id, agent.code AS agent_code, agent.name AS agent_name, agent.agent_type
          FROM eip_auth.auth_identity_agent AS link
          JOIN eip_core.agent AS agent
            ON agent.id = link.agent_id
           AND agent.tenant_id = link.tenant_id
          WHERE link.tenant_id = identity.tenant_id
            AND link.identity_id = identity.id
            AND link.is_active = true
            AND agent.is_active = true
          ORDER BY link.is_primary DESC, link.updated_at DESC, link.id
          LIMIT 1
        ) AS linked ON true
        WHERE identity.tenant_id = $1::uuid
        ORDER BY lower(identity.login), identity.id
        LIMIT $2
        `,
        [session.tenant_id, limit]
      );
      return reply.send({ ok: true, items: result.rows.map(mapControlUser), total: result.rowCount });
    }
  );

  app.get(
    "/owner-admin/control/agents",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 200 } },
        },
      },
    },
    async (req, reply) => {
      const session = await requireRead(app, req, reply, ACCESS_READ);
      if (!session) return;
      const limit = clampLimit(req.query?.limit, 200);
      const result = await app.db.query(
        `
        SELECT id, code, name, agent_type, parent_agent_id
        FROM eip_core.agent
        WHERE tenant_id = $1::uuid
          AND is_active = true
        ORDER BY lower(COALESCE(name, code, agent_type)), id
        LIMIT $2
        `,
        [session.tenant_id, limit]
      );
      return reply.send({
        ok: true,
        items: result.rows.map((row) => ({
          ...row,
          label: row.name || row.code || row.agent_type,
        })),
        total: result.rowCount,
      });
    }
  );

  app.post(
    "/owner-admin/control/users",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["login", "password"],
          properties: {
            login: { type: "string", minLength: 3, maxLength: 200 },
            email: { type: "string", maxLength: 200 },
            password: { type: "string", minLength: 12, maxLength: 128 },
            permissions: { type: "array", maxItems: 100, items: { type: "string", minLength: 2, maxLength: 100 } },
            agent_id: { type: "string", maxLength: 36 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireWrite(app, req, reply, ACCESS_WRITE);
      if (!session) return;

      const login = normalizeText(req.body?.login).toLowerCase();
      const email = normalizeEmail(req.body?.email || (login.includes("@") ? login : ""));
      const password = String(req.body?.password || "");
      const permissions = normalizePermissionCodes(req.body?.permissions);
      const agentId = normalizeText(req.body?.agent_id) || null;
      const strength = evaluatePasswordStrength(password);
      if (!strength.ok) {
        return reply.code(400).send({ ok: false, error: "PASSWORD_POLICY", feedback: strength.feedback });
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply.code(400).send({ ok: false, error: "INVALID_EMAIL" });
      }

      const identityId = crypto.randomUUID();
      const credentialId = crypto.randomUUID();
      const passwordHash = await hashPassword(password);
      const client = await app.db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `
          INSERT INTO eip_auth.auth_identity
            (id, tenant_id, login, login_type, is_active, is_locked, attrs)
          VALUES
            ($1::uuid, $2::uuid, $3, $4, true, false, $5::jsonb)
          `,
          [
            identityId,
            session.tenant_id,
            login,
            login.includes("@") ? "email" : "username",
            JSON.stringify({ ...(email ? { email } : {}), permissions }),
          ]
        );
        await client.query(
          `
          INSERT INTO eip_auth.auth_credential
            (id, tenant_id, identity_id, credential_type, secret_hash, algorithm, meta)
          VALUES
            ($1::uuid, $2::uuid, $3::uuid, 'password', $4, 'argon2id', '{}'::jsonb)
          `,
          [credentialId, session.tenant_id, identityId, passwordHash]
        );
        if (agentId) {
          await setPrimaryAgentLink(client, session.tenant_id, identityId, agentId);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (String(error?.code) === "23505") {
          return reply.code(409).send({ ok: false, error: "LOGIN_ALREADY_EXISTS" });
        }
        if (error?.message === "AGENT_NOT_FOUND") {
          return reply.code(404).send({ ok: false, error: "AGENT_NOT_FOUND" });
        }
        throw error;
      } finally {
        client.release();
      }

      await writeAudit(app, session, {
        code: "owner_admin.user.created",
        category: "access",
        subjectKind: "auth_identity",
        subjectId: identityId,
        summary: `Created login ${login}`,
        attrs: { permission_count: permissions.length, agent_linked: Boolean(agentId) },
      });

      const row = await fetchControlUser(app, session.tenant_id, identityId);
      return reply.code(201).send({ ok: true, user: mapControlUser(row) });
    }
  );

  app.patch(
    "/owner-admin/control/users/:id",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            is_active: { type: "boolean" },
            is_locked: { type: "boolean" },
            permissions: { type: "array", maxItems: 100, items: { type: "string", minLength: 2, maxLength: 100 } },
            agent_id: { type: "string", maxLength: 36 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireWrite(app, req, reply, ACCESS_WRITE);
      if (!session) return;
      const targetId = normalizeText(req.params?.id);
      if (targetId === session.identity_id) {
        return reply.code(409).send({ ok: false, error: "SELF_ACCESS_CHANGE_FORBIDDEN" });
      }

      const hasActive = typeof req.body?.is_active === "boolean";
      const hasLocked = typeof req.body?.is_locked === "boolean";
      const hasPermissions = Array.isArray(req.body?.permissions);
      const hasAgent = Object.prototype.hasOwnProperty.call(req.body || {}, "agent_id");
      if (!hasActive && !hasLocked && !hasPermissions && !hasAgent) {
        return reply.code(400).send({ ok: false, error: "NO_CHANGES" });
      }
      const permissions = hasPermissions ? normalizePermissionCodes(req.body.permissions) : null;
      const agentId = hasAgent ? normalizeText(req.body.agent_id) || null : undefined;

      const client = await app.db.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(
          `
          SELECT id, is_active, is_locked, attrs
          FROM eip_auth.auth_identity
          WHERE tenant_id = $1::uuid
            AND id = $2::uuid
          FOR UPDATE
          `,
          [session.tenant_id, targetId]
        );
        if (current.rowCount !== 1) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ ok: false, error: "USER_NOT_FOUND" });
        }

        const row = current.rows[0];
        const nextAttrs = row.attrs && typeof row.attrs === "object" ? { ...row.attrs } : {};
        if (permissions) nextAttrs.permissions = permissions;
        const nextActive = hasActive ? req.body.is_active : row.is_active;
        const nextLocked = hasLocked ? req.body.is_locked : row.is_locked;

        await client.query(
          `
          UPDATE eip_auth.auth_identity
          SET is_active = $3,
              is_locked = $4,
              attrs = $5::jsonb,
              updated_at = now()
          WHERE tenant_id = $1::uuid
            AND id = $2::uuid
          `,
          [session.tenant_id, targetId, nextActive, nextLocked, JSON.stringify(nextAttrs)]
        );

        if (agentId !== undefined) {
          await setPrimaryAgentLink(client, session.tenant_id, targetId, agentId);
        }

        if (!nextActive || nextLocked) {
          await client.query(
            `
            UPDATE eip_auth.auth_session
            SET is_revoked = true,
                revoked_at = COALESCE(revoked_at, now())
            WHERE tenant_id = $1::uuid
              AND identity_id = $2::uuid
              AND is_revoked = false
            `,
            [session.tenant_id, targetId]
          );
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (error?.message === "AGENT_NOT_FOUND") {
          return reply.code(404).send({ ok: false, error: "AGENT_NOT_FOUND" });
        }
        throw error;
      } finally {
        client.release();
      }

      await writeAudit(app, session, {
        code: "owner_admin.user.access_updated",
        category: "access",
        severity: "warning",
        subjectKind: "auth_identity",
        subjectId: targetId,
        summary: "Updated user access",
        attrs: {
          status_changed: hasActive || hasLocked,
          permissions_changed: hasPermissions,
          agent_link_changed: hasAgent,
          permission_count: permissions?.length ?? null,
        },
      });

      const row = await fetchControlUser(app, session.tenant_id, targetId);
      return reply.send({ ok: true, user: mapControlUser(row) });
    }
  );

  app.get(
    "/owner-admin/control/security/sessions",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 100 } },
        },
      },
    },
    async (req, reply) => {
      const session = await requireRead(app, req, reply, SECURITY_READ);
      if (!session) return;
      const limit = clampLimit(req.query?.limit, 100);
      const result = await app.db.query(
        `
        SELECT session.id,
               session.identity_id,
               identity.login,
               session.device_id,
               COALESCE(device.trust_state, 'unbound') AS device_trust,
               session.attrs->>'assurance' AS assurance,
               session.issued_at,
               session.expires_at
        FROM eip_auth.auth_session AS session
        JOIN eip_auth.auth_identity AS identity
          ON identity.tenant_id = session.tenant_id
         AND identity.id = session.identity_id
        LEFT JOIN eip_auth.auth_device AS device
          ON device.tenant_id = session.tenant_id
         AND device.id = session.device_id
        WHERE session.tenant_id = $1::uuid
          AND session.is_revoked = false
          AND session.expires_at > now()
        ORDER BY session.issued_at DESC
        LIMIT $2
        `,
        [session.tenant_id, limit]
      );
      return reply.send({ ok: true, items: result.rows, total: result.rowCount, current_session_id: session.id });
    }
  );

  app.post(
    "/owner-admin/control/security/sessions/:id/revoke",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } },
        },
      },
    },
    async (req, reply) => {
      const session = await requireWrite(app, req, reply, SECURITY_WRITE);
      if (!session) return;
      const targetId = normalizeText(req.params?.id);
      if (targetId === session.id) {
        return reply.code(409).send({ ok: false, error: "CURRENT_SESSION_PROTECTED" });
      }

      const result = await app.db.query(
        `
        UPDATE eip_auth.auth_session
        SET is_revoked = true,
            revoked_at = COALESCE(revoked_at, now())
        WHERE tenant_id = $1::uuid
          AND id = $2::uuid
          AND is_revoked = false
        RETURNING identity_id
        `,
        [session.tenant_id, targetId]
      );
      if (result.rowCount !== 1) {
        return reply.code(404).send({ ok: false, error: "SESSION_NOT_FOUND" });
      }

      await writeAudit(app, session, {
        code: "owner_admin.session.revoked",
        category: "security",
        severity: "warning",
        subjectKind: "auth_session",
        subjectId: targetId,
        summary: "Revoked an active session",
        attrs: { target_identity_id: result.rows[0].identity_id },
      });
      return reply.send({ ok: true, session_id: targetId, revoked: true });
    }
  );

  app.patch(
    "/owner-admin/control/security/devices/:id",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["trust_state"],
          properties: { trust_state: { type: "string", enum: ["trusted", "untrusted", "revoked"] } },
        },
      },
    },
    async (req, reply) => {
      const session = await requireWrite(app, req, reply, SECURITY_WRITE);
      if (!session) return;
      const targetId = normalizeText(req.params?.id);
      const trustState = normalizeText(req.body?.trust_state).toLowerCase();
      if (!DEVICE_TRUST_STATES.has(trustState)) {
        return reply.code(400).send({ ok: false, error: "INVALID_TRUST_STATE" });
      }

      const client = await app.db.connect();
      let identityId = null;
      try {
        await client.query("BEGIN");
        const updated = await client.query(
          `
          UPDATE eip_auth.auth_device
          SET trust_state = $3,
              revoked_at = CASE WHEN $3 = 'revoked' THEN COALESCE(revoked_at, now()) ELSE NULL END,
              last_seen_at = GREATEST(last_seen_at, now())
          WHERE tenant_id = $1::uuid
            AND id = $2::uuid
          RETURNING identity_id
          `,
          [session.tenant_id, targetId, trustState]
        );
        if (updated.rowCount !== 1) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ ok: false, error: "DEVICE_NOT_FOUND" });
        }
        identityId = updated.rows[0].identity_id;
        if (trustState === "revoked") {
          await client.query(
            `
            UPDATE eip_auth.auth_session
            SET is_revoked = true,
                revoked_at = COALESCE(revoked_at, now())
            WHERE tenant_id = $1::uuid
              AND device_id = $2::uuid
              AND is_revoked = false
            `,
            [session.tenant_id, targetId]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      await writeAudit(app, session, {
        code: "owner_admin.device.trust_updated",
        category: "security",
        severity: trustState === "revoked" ? "warning" : "info",
        subjectKind: "auth_device",
        subjectId: targetId,
        summary: `Device trust changed to ${trustState}`,
        attrs: { trust_state: trustState, target_identity_id: identityId },
      });
      return reply.send({ ok: true, device_id: targetId, trust_state: trustState });
    }
  );

  app.get("/owner-admin/control/settings", async (req, reply) => {
    const session = await requireRead(app, req, reply, SETTINGS_READ);
    if (!session) return;
    const result = await withTenantTransaction(app.db, session.tenant_id, (client, context) =>
      client.query(
        `
        SELECT tenant_setting_id AS id, setting_key, setting_value, setting_status, updated_at
        FROM tenant.tenant_settings
        WHERE tenant_id = $1::uuid
        ORDER BY setting_key
        LIMIT 200
        `,
        [context.tenantId]
      )
    );
    return reply.send({ ok: true, items: result.rows, total: result.rowCount });
  });

  app.post(
    "/owner-admin/control/settings",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["setting_key", "setting_value"],
          properties: {
            setting_key: { type: "string", minLength: 2, maxLength: 120 },
            setting_value: { type: "object", additionalProperties: true },
            setting_status: { type: "string", enum: ["active", "deprecated", "disabled"] },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireWrite(app, req, reply, SETTINGS_WRITE);
      if (!session) return;
      const key = normalizeText(req.body?.setting_key).toUpperCase();
      if (!/^[A-Z0-9_.:-]+$/.test(key)) {
        return reply.code(400).send({ ok: false, error: "INVALID_SETTING_KEY" });
      }
      const status = normalizeText(req.body?.setting_status || "active").toLowerCase();
      const id = crypto.randomUUID();
      const result = await withTenantTransaction(app.db, session.tenant_id, (client, context) =>
        client.query(
          `
          INSERT INTO tenant.tenant_settings
            (tenant_setting_id, tenant_id, setting_key, setting_value, setting_status)
          VALUES
            ($1::uuid, $2::uuid, $3, $4::jsonb, $5)
          ON CONFLICT (tenant_id, setting_key)
          DO UPDATE SET setting_value = EXCLUDED.setting_value,
                        setting_status = EXCLUDED.setting_status,
                        updated_at = now()
          RETURNING tenant_setting_id AS id, setting_key, setting_value, setting_status, updated_at
          `,
          [id, context.tenantId, key, JSON.stringify(req.body.setting_value || {}), status]
        )
      );
      await writeAudit(app, session, {
        code: "owner_admin.setting.saved",
        category: "settings",
        subjectKind: "tenant_setting",
        subjectId: result.rows[0]?.id,
        summary: `Saved setting ${key}`,
        attrs: { setting_key: key, setting_status: status },
      });
      return reply.send({ ok: true, setting: result.rows[0] });
    }
  );

  app.patch(
    "/owner-admin/control/settings/:id",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            setting_value: { type: "object", additionalProperties: true },
            setting_status: { type: "string", enum: ["active", "deprecated", "disabled"] },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireWrite(app, req, reply, SETTINGS_WRITE);
      if (!session) return;
      const id = normalizeText(req.params?.id);
      const hasValue = req.body?.setting_value && typeof req.body.setting_value === "object" && !Array.isArray(req.body.setting_value);
      const hasStatus = typeof req.body?.setting_status === "string";
      if (!hasValue && !hasStatus) {
        return reply.code(400).send({ ok: false, error: "NO_CHANGES" });
      }
      const status = hasStatus ? normalizeText(req.body.setting_status).toLowerCase() : null;
      if (status && !SETTING_STATUSES.has(status)) {
        return reply.code(400).send({ ok: false, error: "INVALID_SETTING_STATUS" });
      }

      const result = await withTenantTransaction(app.db, session.tenant_id, (client, context) =>
        client.query(
          `
          UPDATE tenant.tenant_settings
          SET setting_value = CASE WHEN $3::boolean THEN $4::jsonb ELSE setting_value END,
              setting_status = COALESCE($5, setting_status),
              updated_at = now()
          WHERE tenant_id = $1::uuid
            AND tenant_setting_id = $2::uuid
          RETURNING tenant_setting_id AS id, setting_key, setting_value, setting_status, updated_at
          `,
          [context.tenantId, id, hasValue, JSON.stringify(hasValue ? req.body.setting_value : {}), status]
        )
      );
      if (result.rowCount !== 1) {
        return reply.code(404).send({ ok: false, error: "SETTING_NOT_FOUND" });
      }
      await writeAudit(app, session, {
        code: "owner_admin.setting.updated",
        category: "settings",
        subjectKind: "tenant_setting",
        subjectId: id,
        summary: `Updated setting ${result.rows[0].setting_key}`,
        attrs: { setting_key: result.rows[0].setting_key, setting_status: result.rows[0].setting_status },
      });
      return reply.send({ ok: true, setting: result.rows[0] });
    }
  );

  app.get(
    "/owner-admin/control/audit",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 100 },
            category: { type: "string", maxLength: 50 },
            severity: { type: "string", enum: ["info", "warning", "critical"] },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireRead(app, req, reply, AUDIT_READ);
      if (!session) return;
      const limit = clampLimit(req.query?.limit, 100);
      const category = normalizeText(req.query?.category).toLowerCase();
      const severity = normalizeText(req.query?.severity).toLowerCase();
      const result = await app.db.query(
        `
        SELECT event.id,
               event.event_code,
               event.category,
               event.severity,
               event.outcome,
               event.subject_kind,
               event.subject_id,
               event.summary,
               event.occurred_at,
               actor.login AS actor_login
        FROM security.audit_event AS event
        LEFT JOIN eip_auth.auth_identity AS actor
          ON actor.tenant_id = event.tenant_id
         AND actor.id = event.actor_identity_id
        WHERE event.tenant_id = $1::uuid
          AND ($2::text = '' OR lower(event.category) = $2)
          AND ($3::text = '' OR lower(event.severity) = $3)
        ORDER BY event.occurred_at DESC, event.id DESC
        LIMIT $4
        `,
        [session.tenant_id, category, severity, limit]
      );
      return reply.send({ ok: true, items: result.rows, total: result.rowCount });
    }
  );

  app.get(
    "/owner-admin/control/schema-catalog",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { schema: { type: "string", maxLength: 40 } },
        },
      },
    },
    async (req, reply) => {
      const session = await requireRead(app, req, reply, SCHEMA_READ);
      if (!session) return;
      const requestedSchema = normalizeText(req.query?.schema).toLowerCase();
      if (requestedSchema && !SCHEMA_CATALOG_ALLOWLIST.includes(requestedSchema)) {
        return reply.code(400).send({ ok: false, error: "SCHEMA_NOT_ALLOWED" });
      }
      const result = await app.db.query(
        `
        SELECT table_schema,
               table_name,
               count(*)::int AS column_count,
               string_agg(column_name || ' ' || data_type, ', ' ORDER BY ordinal_position) AS columns
        FROM information_schema.columns
        WHERE table_schema = ANY($1::text[])
          AND ($2::text = '' OR table_schema = $2)
        GROUP BY table_schema, table_name
        ORDER BY table_schema, table_name
        LIMIT 500
        `,
        [SCHEMA_CATALOG_ALLOWLIST, requestedSchema]
      );
      return reply.send({ ok: true, items: result.rows, total: result.rowCount, row_data_exposed: false });
    }
  );

  app.get(
    "/owner-admin/control/tenant-requests",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { type: "string", maxLength: 32 },
            q: { type: "string", maxLength: 200 },
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireRead(app, req, reply, TENANT_REQUEST_READ);
      if (!session) return;
      const status = normalizeText(req.query?.status).toUpperCase();
      if (status && !TENANT_REQUEST_STATUSES.has(status)) {
        return reply.code(400).send({ ok: false, error: "INVALID_STATUS" });
      }
      const q = normalizeText(req.query?.q);
      const limit = clampLimit(req.query?.limit, 100);
      const result = await app.db.query(
        `
        SELECT request.*,
               tenant.tenant_code
        FROM kernel.tenant_request AS request
        LEFT JOIN kernel.tenants AS tenant
          ON tenant.tenant_id = request.tenant_id
        WHERE ($1::text = '' OR request.status_code = $1)
          AND (
            $2::text = ''
            OR request.legal_name ILIKE '%' || $2 || '%'
            OR request.email ILIKE '%' || $2 || '%'
            OR request.ref_code ILIKE '%' || $2 || '%'
          )
        ORDER BY request.created_at DESC
        LIMIT $3
        `,
        [status, q, limit]
      );
      return reply.send({ ok: true, items: result.rows.map(mapTenantRequest), total: result.rowCount });
    }
  );

  app.post(
    "/owner-admin/control/tenant-requests/:id/approve",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } },
        },
      },
    },
    async (req, reply) => {
      const session = await requireWrite(app, req, reply, TENANT_REQUEST_WRITE);
      if (!session) return;
      const requestId = normalizeText(req.params?.id);
      const client = await app.db.connect();
      let requestRow;
      let tenantId;
      let tenantCode;
      let identityId;
      let bootstrapToken;
      try {
        await client.query("BEGIN");
        const selected = await client.query(
          `SELECT * FROM kernel.tenant_request WHERE id = $1::uuid FOR UPDATE`,
          [requestId]
        );
        if (selected.rowCount !== 1) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ ok: false, error: "TENANT_REQUEST_NOT_FOUND" });
        }
        requestRow = selected.rows[0];
        if (!["SUBMITTED", "UNDER_REVIEW", "EXPIRED"].includes(requestRow.status_code)) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ ok: false, error: "INVALID_STATUS" });
        }

        tenantId = crypto.randomUUID();
        tenantCode = createTenantCode(requestRow.legal_name);
        identityId = crypto.randomUUID();
        const organisationAgentId = crypto.randomUUID();
        const personAgentId = crypto.randomUUID();
        bootstrapToken = createBootstrapToken();
        const tokenHash = hashBootstrapToken(app, bootstrapToken);
        const expiresAt = new Date(Date.now() + BOOTSTRAP_TTL_MS);

        await client.query(
          `
          INSERT INTO kernel.tenants
            (tenant_id, tenant_code, tenant_name, tenancy_mode, tenant_status)
          VALUES
            ($1::uuid, $2, $3, 'POOL', 'suspended')
          `,
          [tenantId, tenantCode, requestRow.legal_name]
        );
        await client.query(
          `
          INSERT INTO eip_core.agent
            (id, tenant_id, agent_type, code, name, attrs, is_active)
          VALUES
            ($1::uuid, $3::uuid, 'organisation', 'ORG', $4, $5::jsonb, true),
            ($2::uuid, $3::uuid, 'person', 'ADMIN', $6, $7::jsonb, true)
          `,
          [
            organisationAgentId,
            personAgentId,
            tenantId,
            requestRow.legal_name,
            JSON.stringify({ onboarding_request_id: requestId }),
            requestRow.email,
            JSON.stringify({ onboarding_request_id: requestId, role: "owner_admin" }),
          ]
        );
        await client.query(
          `UPDATE eip_core.agent SET parent_agent_id = $2::uuid WHERE id = $1::uuid AND tenant_id = $3::uuid`,
          [personAgentId, organisationAgentId, tenantId]
        );
        await client.query(
          `
          INSERT INTO eip_auth.auth_identity
            (id, tenant_id, login, login_type, is_active, is_locked, attrs)
          VALUES
            ($1::uuid, $2::uuid, $3, 'email', false, false, $4::jsonb)
          `,
          [
            identityId,
            tenantId,
            requestRow.email,
            JSON.stringify({
              email: requestRow.email,
              permissions: OWNER_ADMIN_PERMISSION_CODES,
              onboarding_request_id: requestId,
            }),
          ]
        );
        await client.query(
          `
          INSERT INTO eip_auth.auth_identity_agent
            (tenant_id, identity_id, agent_id, is_primary, is_active, attrs)
          VALUES
            ($1::uuid, $2::uuid, $3::uuid, true, true, '{}'::jsonb)
          `,
          [tenantId, identityId, personAgentId]
        );
        await client.query(
          `
          UPDATE kernel.tenant_request
          SET status_code = 'BOOTSTRAP_PENDING',
              tenant_id = $2::uuid,
              admin_identity_id = $3::uuid,
              bootstrap_token_hash = $4,
              bootstrap_expires_at = $5,
              bootstrap_used_at = NULL,
              attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object(
                'review', jsonb_build_object(
                  'approved_by_identity_id', $6::uuid,
                  'approved_at', now()
                )
              ),
              updated_at = now()
          WHERE id = $1::uuid
          `,
          [requestId, tenantId, identityId, tokenHash, expiresAt, session.identity_id]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (String(error?.code) === "23505") {
          return reply.code(409).send({ ok: false, error: "TENANT_CODE_OR_LOGIN_CONFLICT" });
        }
        throw error;
      } finally {
        client.release();
      }

      let delivery = "email";
      try {
        await sendBootstrapEmail(app, requestRow, bootstrapToken, "approved");
      } catch (error) {
        delivery = "failed";
        req.log.error({ event: "tenant_bootstrap_email_failed", requestId, email: maskEmail(requestRow.email), message: error?.message || String(error) });
      }

      await writeAudit(app, session, {
        code: "owner_admin.tenant_request.approved",
        category: "onboarding",
        severity: "warning",
        subjectKind: "tenant_request",
        subjectId: requestId,
        summary: `Approved tenant request ${requestRow.ref_code}`,
        attrs: { tenant_id: tenantId, tenant_code: tenantCode, delivery },
      });

      return reply.send({
        ok: true,
        request_id: requestId,
        status_code: "BOOTSTRAP_PENDING",
        tenant_id: tenantId,
        tenant_code: tenantCode,
        login: requestRow.email,
        delivery,
      });
    }
  );

  app.post(
    "/owner-admin/control/tenant-requests/:id/reject",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reason"],
          properties: { reason: { type: "string", minLength: 3, maxLength: 500 } },
        },
      },
    },
    async (req, reply) => {
      const session = await requireWrite(app, req, reply, TENANT_REQUEST_WRITE);
      if (!session) return;
      const requestId = normalizeText(req.params?.id);
      const reason = normalizeText(req.body?.reason);
      const client = await app.db.connect();
      let row;
      try {
        await client.query("BEGIN");
        const selected = await client.query(
          `SELECT * FROM kernel.tenant_request WHERE id = $1::uuid FOR UPDATE`,
          [requestId]
        );
        if (selected.rowCount !== 1) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ ok: false, error: "TENANT_REQUEST_NOT_FOUND" });
        }
        row = selected.rows[0];
        if (row.status_code === "ACTIVE") {
          await client.query("ROLLBACK");
          return reply.code(409).send({ ok: false, error: "ACTIVE_REQUEST_CANNOT_BE_REJECTED" });
        }
        if (row.tenant_id) {
          await client.query(
            `UPDATE kernel.tenants SET tenant_status = 'closed', updated_at = now() WHERE tenant_id = $1::uuid`,
            [row.tenant_id]
          );
          await client.query(
            `UPDATE eip_auth.auth_identity SET is_active = false, updated_at = now() WHERE tenant_id = $1::uuid`,
            [row.tenant_id]
          );
          await client.query(
            `UPDATE eip_auth.auth_session SET is_revoked = true, revoked_at = COALESCE(revoked_at, now()) WHERE tenant_id = $1::uuid AND is_revoked = false`,
            [row.tenant_id]
          );
        }
        await client.query(
          `
          UPDATE kernel.tenant_request
          SET status_code = 'REJECTED',
              bootstrap_token_hash = NULL,
              bootstrap_expires_at = NULL,
              attrs = COALESCE(attrs, '{}'::jsonb) || jsonb_build_object(
                'review', jsonb_build_object(
                  'rejected_by_identity_id', $2::uuid,
                  'rejected_at', now(),
                  'reason', $3::text
                )
              ),
              updated_at = now()
          WHERE id = $1::uuid
          `,
          [requestId, session.identity_id, reason]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      await writeAudit(app, session, {
        code: "owner_admin.tenant_request.rejected",
        category: "onboarding",
        severity: "warning",
        subjectKind: "tenant_request",
        subjectId: requestId,
        summary: `Rejected tenant request ${row.ref_code}`,
        attrs: { reason },
      });
      return reply.send({ ok: true, request_id: requestId, status_code: "REJECTED" });
    }
  );

  app.post(
    "/owner-admin/control/tenant-requests/:id/resend",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", minLength: 36, maxLength: 36 } },
        },
      },
    },
    async (req, reply) => {
      const session = await requireWrite(app, req, reply, TENANT_REQUEST_WRITE);
      if (!session) return;
      const requestId = normalizeText(req.params?.id);
      const token = createBootstrapToken();
      const tokenHash = hashBootstrapToken(app, token);
      const expiresAt = new Date(Date.now() + BOOTSTRAP_TTL_MS);
      const result = await app.db.query(
        `
        UPDATE kernel.tenant_request
        SET bootstrap_token_hash = $2,
            bootstrap_expires_at = $3,
            bootstrap_used_at = NULL,
            updated_at = now()
        WHERE id = $1::uuid
          AND status_code = 'BOOTSTRAP_PENDING'
        RETURNING *
        `,
        [requestId, tokenHash, expiresAt]
      );
      if (result.rowCount !== 1) {
        return reply.code(409).send({ ok: false, error: "BOOTSTRAP_NOT_PENDING" });
      }
      const row = result.rows[0];
      let delivery = "email";
      try {
        await sendBootstrapEmail(app, row, token, "resend");
      } catch (error) {
        delivery = "failed";
        req.log.error({ event: "tenant_bootstrap_resend_failed", requestId, email: maskEmail(row.email), message: error?.message || String(error) });
      }
      await writeAudit(app, session, {
        code: "owner_admin.tenant_request.bootstrap_resent",
        category: "onboarding",
        severity: "info",
        subjectKind: "tenant_request",
        subjectId: requestId,
        summary: `Regenerated bootstrap link for ${row.ref_code}`,
        attrs: { delivery },
      });
      return reply.send({ ok: true, request_id: requestId, status_code: "BOOTSTRAP_PENDING", delivery });
    }
  );
}

export {
  OWNER_ADMIN_PERMISSION_CODES,
  hashBootstrapToken,
  normalizePermissionCodes,
};
