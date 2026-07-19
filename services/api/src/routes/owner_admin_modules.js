import crypto from "node:crypto";

const MAX_LIMIT = 200;
const READ_PERMISSIONS = ["PROCESS_DEF_READ", "CRM_PROCESS_DEF_READ"];
const WRITE_PERMISSIONS = ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"];

const OWNER_MODULES = Object.freeze({
  dashboard: Object.freeze({
    code: "dashboard",
    label: "Dashboard",
    objectType: "owner_admin.dashboard",
    codePrefix: "dash",
  }),
  tenant_requests: Object.freeze({
    code: "tenant_requests",
    label: "Tenant Requests",
    objectType: "owner_admin.tenant_requests",
    codePrefix: "treq",
  }),
  connections: Object.freeze({
    code: "connections",
    label: "Connections",
    objectType: "owner_admin.connections",
    codePrefix: "conn",
  }),
  tasks_follow_up: Object.freeze({
    code: "tasks_follow_up",
    label: "Tasks & Follow-up",
    objectType: "owner_admin.tasks_follow_up",
    codePrefix: "task",
  }),
  users_roles: Object.freeze({
    code: "users_roles",
    label: "Users & Roles",
    objectType: "owner_admin.users_roles",
    codePrefix: "user",
  }),
  portfolios: Object.freeze({
    code: "portfolios",
    label: "Portfolios",
    objectType: "owner_admin.portfolios",
    codePrefix: "port",
  }),
  templates: Object.freeze({
    code: "templates",
    label: "Templates",
    objectType: "owner_admin.templates",
    codePrefix: "tmpl",
  }),
  security: Object.freeze({
    code: "security",
    label: "Security",
    objectType: "owner_admin.security",
    codePrefix: "sec",
  }),
  audit: Object.freeze({
    code: "audit",
    label: "Audit",
    objectType: "owner_admin.audit",
    codePrefix: "aud",
  }),
  data_explorer: Object.freeze({
    code: "data_explorer",
    label: "Data Explorer",
    objectType: "owner_admin.data_explorer",
    codePrefix: "data",
  }),
  integrations: Object.freeze({
    code: "integrations",
    label: "Integrations",
    objectType: "owner_admin.integrations",
    codePrefix: "intg",
  }),
  reports: Object.freeze({
    code: "reports",
    label: "Reports",
    objectType: "owner_admin.reports",
    codePrefix: "rpt",
  }),
  settings: Object.freeze({
    code: "settings",
    label: "Settings",
    objectType: "owner_admin.settings",
    codePrefix: "set",
  }),
});

function normalizeText(value) {
  return String(value || "").trim();
}
function normalizeOptionalText(value) {
  const trimmed = normalizeText(value);
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatus(value, fallback = "active") {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  return normalized;
}

function clampLimit(value) {
  const parsed = Number(value || 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function sanitizeModuleKey(rawKey) {
  return normalizeText(rawKey).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
}

function resolveOwnerModule(rawModule) {
  const key = sanitizeModuleKey(rawModule);
  return OWNER_MODULES[key] || null;
}

function sanitizeRecordCode(rawValue) {
  const text = normalizeText(rawValue).toLowerCase();
  if (!text) return null;
  const cleaned = text
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .replace(/[_\-.]{2,}/g, "_")
    .slice(0, 72);
  return cleaned || null;
}

function buildRecordCode(moduleConfig, requestedCode) {
  const prefix = moduleConfig.codePrefix;
  const sanitized = sanitizeRecordCode(requestedCode);
  if (!sanitized) {
    return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
  }
  if (sanitized.startsWith(`${prefix}_`)) return sanitized;
  return `${prefix}_${sanitized}`;
}

function mapRecordRow(row, moduleConfig) {
  const attrs = asObject(row?.attrs);
  return {
    id: row.id,
    module: moduleConfig.code,
    code: row.code || attrs.code || "",
    title: row.title || attrs.title || attrs.name || "",
    status: row.status || attrs.status || "active",
    owner: attrs.owner || attrs.assigned_owner || attrs.assigned_to || "",
    updated_at: row.updated_at || null,
    created_at: row.created_at || null,
    ...attrs,
    attrs,
  };
}

async function requireOwnerPermissions(app, req, reply, requiredPermissions, { write = false } = {}) {
  const authz = await app.requirePermission(req, requiredPermissions, { realm: "EIP" });
  if (!authz.ok) {
    return reply.code(authz.status).send({ ok: false, error: authz.error });
  }

  if (write) {
    const csrf = await app.requireCsrf(req);
    if (!csrf.ok) {
      return reply.code(csrf.status).send({ ok: false, error: csrf.error });
    }
  }

  return authz.session;
}

function resolveTenantScope(session, requestedTenantId) {
  const requested = normalizeOptionalText(requestedTenantId);
  if (!requested || requested === session.tenant_id) {
    return { ok: true, tenantId: session.tenant_id };
  }
  return { ok: false, error: "TENANT_ACCESS_REQUIRED" };
}

export default async function ownerAdminModuleRoutes(app) {
  app.get(
    "/owner-admin/modules/:module/records",
    {
      schema: {
        params: {
          type: "object",
          required: ["module"],
          properties: {
            module: { type: "string", minLength: 2, maxLength: 64 },
          },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            tenant_id: { type: "string", minLength: 36, maxLength: 36 },
            status: { type: "string", minLength: 1, maxLength: 64 },
            q: { type: "string", minLength: 1, maxLength: 200 },
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const moduleConfig = resolveOwnerModule(req.params.module);
      if (!moduleConfig) {
        return reply.code(404).send({ ok: false, error: "OWNER_MODULE_NOT_FOUND" });
      }

      const session = await requireOwnerPermissions(app, req, reply, READ_PERMISSIONS);
      if (!session) return;

      const scope = resolveTenantScope(session, req.query?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const limit = clampLimit(req.query?.limit);
      const offset = Number(req.query?.offset || 0);
      const status = normalizeOptionalText(req.query?.status);
      const queryText = normalizeOptionalText(req.query?.q);

      const params = [scope.tenantId, moduleConfig.objectType];
      const filters = ["tenant_id = $1::uuid", "object_type = $2"];

      if (status) {
        params.push(normalizeStatus(status));
        filters.push(`lower(status) = lower($${params.length})`);
      }

      if (queryText) {
        params.push(`%${queryText}%`);
        filters.push(`(code ILIKE $${params.length} OR title ILIKE $${params.length} OR attrs::text ILIKE $${params.length})`);
      }

      const whereClause = filters.join(" AND ");

      const countResult = await app.db.query(
        `
        SELECT count(*)::int AS total
        FROM eip_core.service_object
        WHERE ${whereClause}
        `,
        params
      );

      params.push(limit);
      params.push(offset);

      const records = await app.db.query(
        `
        SELECT id, code, title, status, attrs, created_at, updated_at
        FROM eip_core.service_object
        WHERE ${whereClause}
        ORDER BY coalesce(updated_at, created_at) DESC, id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
        `,
        params
      );

      return reply.send({
        ok: true,
        module: moduleConfig.code,
        items: records.rows.map((row) => mapRecordRow(row, moduleConfig)),
        total: countResult.rows[0]?.total ?? 0,
        limit,
        offset,
      });
    }
  );

  app.post(
    "/owner-admin/modules/:module/records",
    {
      schema: {
        params: {
          type: "object",
          required: ["module"],
          properties: {
            module: { type: "string", minLength: 2, maxLength: 64 },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            tenant_id: { type: "string", minLength: 36, maxLength: 36 },
            code: { type: "string", maxLength: 120 },
            title: { type: "string", maxLength: 240 },
            status: { type: "string", maxLength: 80 },
            attrs: { type: "object" },
          },
        },
      },
    },
    async (req, reply) => {
      const moduleConfig = resolveOwnerModule(req.params.module);
      if (!moduleConfig) {
        return reply.code(404).send({ ok: false, error: "OWNER_MODULE_NOT_FOUND" });
      }

      const session = await requireOwnerPermissions(app, req, reply, WRITE_PERMISSIONS, { write: true });
      if (!session) return;

      const scope = resolveTenantScope(session, req.body?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const body = req.body || {};
      const code = buildRecordCode(moduleConfig, body.code || body.title || "");
      const title = normalizeOptionalText(body.title) || code;
      const status = normalizeStatus(body.status, "active");
      const attrs = {
        module: moduleConfig.code,
        ...asObject(body.attrs),
      };

      const created = await app.db.query(
        `
        INSERT INTO eip_core.service_object
          (tenant_id, object_type, code, title, status, attrs)
        VALUES
          ($1::uuid, $2, $3, $4, $5, $6::jsonb)
        RETURNING id, code, title, status, attrs, created_at, updated_at
        `,
        [scope.tenantId, moduleConfig.objectType, code, title, status, JSON.stringify(attrs)]
      );

      return reply.send({
        ok: true,
        module: moduleConfig.code,
        item: mapRecordRow(created.rows[0], moduleConfig),
      });
    }
  );

  app.patch(
    "/owner-admin/modules/:module/records/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["module", "id"],
          properties: {
            module: { type: "string", minLength: 2, maxLength: 64 },
            id: { type: "string", minLength: 36, maxLength: 36 },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            tenant_id: { type: "string", minLength: 36, maxLength: 36 },
            code: { type: "string", maxLength: 120 },
            title: { type: "string", maxLength: 240 },
            status: { type: "string", maxLength: 80 },
            attrs: { type: "object" },
          },
        },
      },
    },
    async (req, reply) => {
      const moduleConfig = resolveOwnerModule(req.params.module);
      if (!moduleConfig) {
        return reply.code(404).send({ ok: false, error: "OWNER_MODULE_NOT_FOUND" });
      }

      const session = await requireOwnerPermissions(app, req, reply, WRITE_PERMISSIONS, { write: true });
      if (!session) return;

      const scope = resolveTenantScope(session, req.body?.tenant_id || req.query?.tenant_id);
      if (!scope.ok) {
        return reply.code(403).send({ ok: false, error: scope.error });
      }

      const body = req.body || {};
      const code = normalizeOptionalText(body.code)
        ? buildRecordCode(moduleConfig, body.code)
        : null;
      const title = normalizeOptionalText(body.title);
      const status = normalizeOptionalText(body.status);
      const attrs = asObject(body.attrs);
      const hasAttrChanges = Object.keys(attrs).length > 0;

      const updated = await app.db.query(
        `
        UPDATE eip_core.service_object
        SET code = COALESCE($4, code),
            title = COALESCE($5, title),
            status = COALESCE($6, status),
            attrs = COALESCE(attrs, '{}'::jsonb)
                    || jsonb_build_object('module', $3)
                    || COALESCE($7::jsonb, '{}'::jsonb),
            updated_at = now()
        WHERE tenant_id = $1::uuid
          AND object_type = $2
          AND id = $8::uuid
        RETURNING id, code, title, status, attrs, created_at, updated_at
        `,
        [
          scope.tenantId,
          moduleConfig.objectType,
          moduleConfig.code,
          code,
          title,
          status ? normalizeStatus(status) : null,
          hasAttrChanges ? JSON.stringify(attrs) : null,
          req.params.id,
        ]
      );

      if (updated.rowCount === 0) {
        return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
      }

      return reply.send({
        ok: true,
        module: moduleConfig.code,
        item: mapRecordRow(updated.rows[0], moduleConfig),
      });
    }
  );
}
