import { withTenantTransaction } from "../db/tenantTransaction.js";

const MAX_LIMIT = 200;
const CONSOLE_READ = ["OWNER_ADMIN_CONSOLE_READ"];
const ACCESS_READ = ["OWNER_ADMIN_ACCESS_READ"];
const SECURITY_READ = ["OWNER_ADMIN_SECURITY_READ"];
const SETTINGS_READ = ["OWNER_ADMIN_SETTINGS_READ"];

function clampLimit(value, fallback = 50) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

async function requireRead(app, req, reply, permissionCodes) {
  const result = await app.requirePermission(req, permissionCodes, { realm: "EIP" });
  if (!result.ok) {
    reply.code(result.status).send({ ok: false, error: result.error });
    return null;
  }
  return result.session;
}

function mapAccount(row) {
  if (!row) return null;
  const attrs = row.identity_attrs && typeof row.identity_attrs === "object" ? row.identity_attrs : {};
  return {
    tenant_id: row.tenant_id,
    tenant_code: row.tenant_code || null,
    tenant_name: row.tenant_name || null,
    identity_id: row.identity_id,
    login: row.login || null,
    email: typeof attrs.email === "string" ? attrs.email : null,
  };
}

function mapActivity(row) {
  return {
    id: row.id,
    event_kind: row.event_kind,
    subject_code: row.subject_code || null,
    subject_title: row.subject_title || null,
    from_status: row.from_status || null,
    to_status: row.to_status,
    reason_code: row.reason_code || null,
    occurred_at: row.occurred_at,
  };
}

function mapTask(row) {
  return {
    id: row.id,
    code: row.service_object_code || null,
    title: row.title || row.task_type,
    task_type: row.task_type,
    status: row.status,
    due_at: row.due_at || null,
    completed_at: row.completed_at || null,
    updated_at: row.updated_at,
  };
}

function mapIdentity(row) {
  const attrs = row.attrs && typeof row.attrs === "object" ? row.attrs : {};
  const permissionCodes = Array.isArray(attrs.permissions)
    ? attrs.permissions.map((value) => String(value)).filter(Boolean)
    : [];
  return {
    id: row.id,
    login: row.login,
    email: typeof attrs.email === "string" ? attrs.email : null,
    login_type: row.login_type,
    status: row.is_locked ? "locked" : row.is_active ? "active" : "inactive",
    permission_count: permissionCodes.length,
    updated_at: row.updated_at,
  };
}

function mapSession(row) {
  return {
    row_key: `${row.identity_id}:${row.device_id || "none"}:${new Date(row.issued_at).toISOString()}`,
    identity_id: row.identity_id,
    login: row.login,
    device_id: row.device_id || null,
    device_trust: row.device_trust || "unbound",
    assurance: row.assurance || null,
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    last_seen_at: row.last_seen_at || row.issued_at,
  };
}

function mapDevice(row) {
  return {
    id: row.id,
    login: row.login,
    trust_state: row.trust_state,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    revoked_at: row.revoked_at || null,
  };
}

function mapSetting(row) {
  return {
    id: row.tenant_setting_id,
    setting_key: row.setting_key,
    status: row.setting_status,
    updated_at: row.updated_at,
  };
}

export default async function ownerAdminConsoleRoutes(app) {
  app.get("/owner-admin/account", async (req, reply) => {
    const session = await requireRead(app, req, reply, CONSOLE_READ);
    if (!session) return;

    const result = await app.db.query(
      `
      SELECT
        identity.tenant_id,
        tenant.tenant_code,
        tenant.tenant_name,
        identity.id AS identity_id,
        identity.login,
        COALESCE(identity.attrs, '{}'::jsonb) AS identity_attrs
      FROM eip_auth.auth_identity AS identity
      JOIN kernel.tenants AS tenant
        ON tenant.tenant_id = identity.tenant_id
      WHERE identity.tenant_id = $1::uuid
        AND identity.id = $2::uuid
      LIMIT 1
      `,
      [session.tenant_id, session.identity_id]
    );

    return reply.send({ ok: true, account: mapAccount(result.rows[0]) });
  });

  app.get("/owner-admin/overview", async (req, reply) => {
    const session = await requireRead(app, req, reply, CONSOLE_READ);
    if (!session) return;

    const result = await app.db.query(
      `
      SELECT
        (SELECT count(*)::int
         FROM eip_core.service_object
         WHERE tenant_id = $1::uuid
           AND object_type NOT LIKE 'owner_admin.%') AS service_objects,
        (SELECT count(*)::int
         FROM eip_core.task
         WHERE tenant_id = $1::uuid
           AND completed_at IS NULL) AS open_tasks,
        (SELECT count(*)::int
         FROM eip_core.process_def
         WHERE tenant_id = $1::uuid
           AND is_active = true) AS active_process_definitions,
        (SELECT count(*)::int
         FROM eip_core.process_instance
         WHERE tenant_id = $1::uuid
           AND ended_at IS NULL) AS active_process_instances,
        (SELECT count(*)::int
         FROM eip_auth.auth_identity
         WHERE tenant_id = $1::uuid
           AND is_active = true
           AND is_locked = false) AS active_identities,
        (SELECT count(*)::int
         FROM eip_auth.auth_session
         WHERE tenant_id = $1::uuid
           AND is_revoked = false
           AND expires_at > now()) AS active_sessions
      `,
      [session.tenant_id]
    );

    return reply.send({
      ok: true,
      metrics: result.rows[0] || {},
      generated_at: new Date().toISOString(),
    });
  });

  app.get(
    "/owner-admin/activity",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 30 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireRead(app, req, reply, CONSOLE_READ);
      if (!session) return;
      const limit = clampLimit(req.query?.limit, 30);

      const result = await app.db.query(
        `
        SELECT *
        FROM (
          SELECT
            event.id,
            'service_object'::text AS event_kind,
            object.code AS subject_code,
            object.title AS subject_title,
            event.from_status,
            event.to_status,
            event.reason_code,
            event.occurred_at
          FROM eip_core.service_object_status_event AS event
          JOIN eip_core.service_object AS object
            ON object.id = event.service_object_id
           AND object.tenant_id = event.tenant_id
          WHERE event.tenant_id = $1::uuid
            AND object.object_type NOT LIKE 'owner_admin.%'

          UNION ALL

          SELECT
            event.id,
            'task'::text AS event_kind,
            object.code AS subject_code,
            COALESCE(task.title, task.task_type) AS subject_title,
            event.from_status,
            event.to_status,
            event.reason_code,
            event.occurred_at
          FROM eip_core.task_status_event AS event
          JOIN eip_core.task AS task
            ON task.id = event.task_id
           AND task.tenant_id = event.tenant_id
          JOIN eip_core.service_object AS object
            ON object.id = task.service_object_id
           AND object.tenant_id = task.tenant_id
          WHERE event.tenant_id = $1::uuid
            AND object.object_type NOT LIKE 'owner_admin.%'
        ) AS activity
        ORDER BY occurred_at DESC, id DESC
        LIMIT $2
        `,
        [session.tenant_id, limit]
      );

      return reply.send({
        ok: true,
        items: result.rows.map(mapActivity),
        total: result.rowCount,
      });
    }
  );

  app.get(
    "/owner-admin/tasks",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireRead(app, req, reply, CONSOLE_READ);
      if (!session) return;
      const limit = clampLimit(req.query?.limit, 100);

      const result = await app.db.query(
        `
        SELECT
          task.id,
          object.code AS service_object_code,
          task.title,
          task.task_type,
          task.status,
          task.due_at,
          task.completed_at,
          task.updated_at
        FROM eip_core.task AS task
        JOIN eip_core.service_object AS object
          ON object.id = task.service_object_id
         AND object.tenant_id = task.tenant_id
        WHERE task.tenant_id = $1::uuid
          AND object.object_type NOT LIKE 'owner_admin.%'
        ORDER BY
          CASE WHEN task.completed_at IS NULL THEN 0 ELSE 1 END,
          task.due_at NULLS LAST,
          task.updated_at DESC
        LIMIT $2
        `,
        [session.tenant_id, limit]
      );

      return reply.send({ ok: true, items: result.rows.map(mapTask), total: result.rowCount });
    }
  );

  app.get(
    "/owner-admin/users",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireRead(app, req, reply, ACCESS_READ);
      if (!session) return;
      const limit = clampLimit(req.query?.limit, 100);

      const result = await app.db.query(
        `
        SELECT id, login, login_type, is_active, is_locked,
               COALESCE(attrs, '{}'::jsonb) AS attrs, updated_at
        FROM eip_auth.auth_identity
        WHERE tenant_id = $1::uuid
        ORDER BY lower(login), id
        LIMIT $2
        `,
        [session.tenant_id, limit]
      );

      return reply.send({ ok: true, items: result.rows.map(mapIdentity), total: result.rowCount });
    }
  );

  app.get(
    "/owner-admin/security/sessions",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireRead(app, req, reply, SECURITY_READ);
      if (!session) return;
      const limit = clampLimit(req.query?.limit, 100);

      const result = await app.db.query(
        `
        SELECT
          auth_session.identity_id,
          auth_session.device_id,
          auth_session.issued_at,
          auth_session.expires_at,
          auth_session.attrs->>'assurance' AS assurance,
          auth_session.attrs->>'last_seen_at' AS last_seen_at,
          identity.login,
          device.trust_state AS device_trust
        FROM eip_auth.auth_session AS auth_session
        JOIN eip_auth.auth_identity AS identity
          ON identity.tenant_id = auth_session.tenant_id
         AND identity.id = auth_session.identity_id
        LEFT JOIN eip_auth.auth_device AS device
          ON device.id = auth_session.device_id
         AND device.tenant_id = auth_session.tenant_id
        WHERE auth_session.tenant_id = $1::uuid
          AND auth_session.is_revoked = false
          AND auth_session.expires_at > now()
        ORDER BY auth_session.issued_at DESC
        LIMIT $2
        `,
        [session.tenant_id, limit]
      );

      return reply.send({ ok: true, items: result.rows.map(mapSession), total: result.rowCount });
    }
  );

  app.get(
    "/owner-admin/security/devices",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireRead(app, req, reply, SECURITY_READ);
      if (!session) return;
      const limit = clampLimit(req.query?.limit, 100);

      const result = await app.db.query(
        `
        SELECT
          device.id,
          identity.login,
          device.trust_state,
          device.first_seen_at,
          device.last_seen_at,
          device.revoked_at
        FROM eip_auth.auth_device AS device
        JOIN eip_auth.auth_identity AS identity
          ON identity.tenant_id = device.tenant_id
         AND identity.id = device.identity_id
        WHERE device.tenant_id = $1::uuid
        ORDER BY device.last_seen_at DESC, device.id
        LIMIT $2
        `,
        [session.tenant_id, limit]
      );

      return reply.send({ ok: true, items: result.rows.map(mapDevice), total: result.rowCount });
    }
  );

  app.get("/owner-admin/settings", async (req, reply) => {
    const session = await requireRead(app, req, reply, SETTINGS_READ);
    if (!session) return;

    const result = await withTenantTransaction(app.db, session.tenant_id, (client, context) =>
      client.query(
        `
        SELECT tenant_setting_id, setting_key, setting_status, updated_at
        FROM tenant.tenant_settings
        WHERE tenant_id = $1::uuid
        ORDER BY setting_key
        LIMIT 200
        `,
        [context.tenantId]
      )
    );

    return reply.send({ ok: true, items: result.rows.map(mapSetting), total: result.rowCount });
  });
}
