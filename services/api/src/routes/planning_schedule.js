import { projectRouteScheduleRows } from "../core/orchestration/processRouteScheduleProjection.js";

const MAX_LIMIT = 100;
const ROUTE_PATH = Object.freeze(["_eip_runtime", "process_route_v1"]);
const READ_PERMISSIONS = [
  "PROCESS_INSTANCE_READ",
  "PROCESS_DEF_READ",
  "CRM_PROCESS_DEF_READ",
  "CRM_PROCESS_DEF_WRITE"
];

function clampLimit(value) {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(parsed)));
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

async function requireRead(app, req, reply) {
  const authz = await app.requirePermission(req, READ_PERMISSIONS, { realm: "EIP" });
  if (!authz.ok) {
    const body = { ok: false, error: authz.error };
    if (Array.isArray(authz.required_permissions) && authz.required_permissions.length > 0) {
      body.required_permissions = authz.required_permissions;
    }
    reply.code(authz.status).send(body);
    return null;
  }

  const csrf = await app.requireCsrf(req);
  if (!csrf.ok) {
    reply.code(csrf.status).send({ ok: false, error: csrf.error });
    return null;
  }

  const schema = await app.db.query(`SELECT to_regclass('eip_core.service_object')::text AS service_object`);
  if (!schema.rows[0]?.service_object) {
    reply.code(503).send({ ok: false, error: "PLANNING_SCHEDULE_SCHEMA_UNAVAILABLE" });
    return null;
  }

  return authz.session;
}

export default async function planningScheduleRoutes(app) {
  app.get(
    "/planning/schedule",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            object_type: { type: "string", maxLength: 64 },
            service_object_id: { type: "string", minLength: 36, maxLength: 36 },
            limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 50 }
          }
        }
      }
    },
    async (req, reply) => {
      const session = await requireRead(app, req, reply);
      if (!session) return;

      const tenantId = session.tenant_id;
      const objectType = optionalText(req.query?.object_type);
      const serviceObjectId = optionalText(req.query?.service_object_id);
      const limit = clampLimit(req.query?.limit);

      const params = [tenantId, ROUTE_PATH];
      const filters = [
        "tenant_id=$1",
        "attrs #> $2::text[] IS NOT NULL"
      ];

      if (objectType) {
        params.push(objectType);
        filters.push(`object_type=$${params.length}`);
      }
      if (serviceObjectId) {
        params.push(serviceObjectId);
        filters.push(`id=$${params.length}`);
      }

      params.push(limit);
      const result = await app.db.query(
        `
        SELECT
          id,
          code,
          title,
          object_type,
          status,
          updated_at,
          attrs #> $2::text[] AS route_snapshot
        FROM eip_core.service_object
        WHERE ${filters.join(" AND ")}
        ORDER BY updated_at DESC, id
        LIMIT $${params.length}
        `,
        params
      );

      const generatedAt = new Date().toISOString();
      const items = projectRouteScheduleRows(result.rows || [], {
        now: generatedAt,
        maxServiceObjects: limit,
        maxProjectedSteps: 5000
      });

      return reply.send({
        ok: true,
        items,
        generated_at: generatedAt,
        service_objects_scanned: result.rowCount,
        limit
      });
    }
  );
}
