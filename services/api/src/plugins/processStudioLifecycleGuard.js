import fp from "fastify-plugin";

import {
  PROCESS_LIFECYCLE,
  assertProcessDraftMutable,
  processRuntimeEligibility,
  resolveProcessLifecycle,
} from "../services/process/processDefinitionLifecycle.js";
import { projectProcessValidationIssues } from "../services/process/processValidationIssues.js";

const RESERVED_LIFECYCLE_ATTRS = new Set([
  "lifecycle_status",
  "lifecycleStatus",
  "is_published",
  "isPublished",
  "is_archived",
  "isArchived",
  "published_at",
  "published_by_identity_id",
  "archived_at",
  "archived_by_identity_id",
  "revision_of_process_def_id",
  "revision_of_version",
  "revision_created_by_identity_id",
  "revision_created_at",
]);

function pathOnly(req) {
  return String(req?.url || "").split("?")[0];
}

function isProcessPath(path, suffixPattern) {
  return new RegExp(`^/api/eip(?:/core)?/process/${suffixPattern}$`).test(path);
}

function sendError(reply, status, error, extra = {}) {
  return reply.code(status).send({ ok: false, error, ...extra });
}

function attrsObject(body) {
  return body?.attrs && typeof body.attrs === "object" && !Array.isArray(body.attrs)
    ? body.attrs
    : null;
}

export function sanitizeDraftLifecycleInput(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: true, body };
  }

  if (body.is_published === true || body.isPublished === true) {
    return { ok: false, error: "PROCESS_PUBLISH_ROUTE_REQUIRED" };
  }

  const attrs = attrsObject(body);
  if (attrs) {
    const requestedLifecycle = String(attrs.lifecycle_status || attrs.lifecycleStatus || "")
      .trim()
      .toLowerCase();
    if (requestedLifecycle && requestedLifecycle !== PROCESS_LIFECYCLE.DRAFT) {
      return { ok: false, error: "PROCESS_LIFECYCLE_ROUTE_REQUIRED" };
    }
    if (attrs.is_published === true || attrs.isPublished === true) {
      return { ok: false, error: "PROCESS_PUBLISH_ROUTE_REQUIRED" };
    }
    if (attrs.is_archived === true || attrs.isArchived === true) {
      return { ok: false, error: "PROCESS_ARCHIVE_ROUTE_REQUIRED" };
    }

    const cleanAttrs = { ...attrs };
    for (const key of RESERVED_LIFECYCLE_ATTRS) delete cleanAttrs[key];
    body.attrs = cleanAttrs;
  }
  delete body.is_published;
  delete body.isPublished;
  return { ok: true, body };
}

async function loadDefinition(app, tenantId, id) {
  const result = await app.db.query(
    `
    SELECT id, code, version, is_active, attrs
    FROM eip_core.process_def
    WHERE tenant_id=$1 AND id=$2
    LIMIT 1
    `,
    [tenantId, id]
  );
  return result.rows[0] || null;
}

async function requireSessionIfPresent(app, req) {
  const auth = await app.requireSession(req, { realm: "EIP" });
  return auth.ok ? auth.session : null;
}

function isOnlyPublishedOperationalToggle(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body).filter((key) => body[key] !== undefined);
  return keys.length > 0 && keys.every((key) => key === "is_active");
}

async function guardDefinitionWrite(app, req, reply, session, id = null) {
  const sanitized = sanitizeDraftLifecycleInput(req.body || {});
  if (!sanitized.ok) return sendError(reply, 409, sanitized.error);
  req.body = sanitized.body;

  if (!id) return null;
  const definition = await loadDefinition(app, session.tenant_id, id);
  if (!definition) return null;

  const mutable = assertProcessDraftMutable(definition.attrs || {});
  if (mutable.ok) return null;

  if (
    mutable.lifecycle === PROCESS_LIFECYCLE.PUBLISHED &&
    isOnlyPublishedOperationalToggle(req.body)
  ) {
    return null;
  }

  return sendError(reply, 409, mutable.error, {
    lifecycle_status: mutable.lifecycle,
    create_revision_required: mutable.lifecycle === PROCESS_LIFECYCLE.PUBLISHED,
  });
}

async function guardTaskTemplateWrite(app, req, reply, session, path) {
  let definition = null;
  if (req.method === "POST") {
    const id = String(req.body?.process_def_id || "").trim();
    if (id) definition = await loadDefinition(app, session.tenant_id, id);
  } else {
    const match = path.match(/\/process\/task-templates\/([0-9a-f-]{36})$/i);
    if (match) {
      const result = await app.db.query(
        `
        SELECT pd.id, pd.code, pd.version, pd.is_active, pd.attrs
        FROM eip_core.task_template tt
        JOIN eip_core.process_def pd
          ON pd.tenant_id=tt.tenant_id AND pd.id=tt.process_def_id
        WHERE tt.tenant_id=$1 AND tt.id=$2
        LIMIT 1
        `,
        [session.tenant_id, match[1]]
      );
      definition = result.rows[0] || null;
    }
  }

  if (!definition) return null;
  const mutable = assertProcessDraftMutable(definition.attrs || {});
  if (mutable.ok) return null;
  return sendError(reply, 409, mutable.error, {
    lifecycle_status: mutable.lifecycle,
    create_revision_required: mutable.lifecycle === PROCESS_LIFECYCLE.PUBLISHED,
  });
}

async function guardBindingWrite(app, req, reply, session, path) {
  let processDefId = String(req.body?.process_def_id || "").trim();
  let requestedActive = req.body?.is_active;

  if (req.method === "PATCH") {
    const match = path.match(/\/process\/bindings\/([0-9a-f-]{36})$/i);
    if (match) {
      const result = await app.db.query(
        `
        SELECT process_def_id, is_active
        FROM eip_core.process_binding
        WHERE tenant_id=$1 AND id=$2
        LIMIT 1
        `,
        [session.tenant_id, match[1]]
      );
      const row = result.rows[0];
      if (row) {
        if (!processDefId) processDefId = String(row.process_def_id || "");
        if (requestedActive === undefined) requestedActive = row.is_active;
      }
    }
  }

  if (!processDefId || requestedActive === false) return null;
  const definition = await loadDefinition(app, session.tenant_id, processDefId);
  if (!definition) return null;
  const eligible = processRuntimeEligibility(definition);
  if (eligible.ok) return null;
  return sendError(reply, 409, "PROCESS_BINDING_TARGET_NOT_PUBLISHED", {
    process_error: eligible.error,
    lifecycle_status: eligible.lifecycle,
  });
}

async function resolvePublishedByCode(app, tenantId, body) {
  const code = String(body?.code || "").trim();
  if (!code) return { ok: false, error: "PROCESS_CODE_REQUIRED" };

  const params = [tenantId, code];
  const filters = ["tenant_id=$1", "code=$2"];
  const module = String(body?.module || "").trim();
  if (module) {
    params.push(module);
    filters.push(`attrs->>'module'=$${params.length}`);
  }
  if (Number.isInteger(body?.version)) {
    params.push(body.version);
    filters.push(`version=$${params.length}`);
  }

  const result = await app.db.query(
    `
    SELECT id, code, version, is_active, attrs
    FROM eip_core.process_def
    WHERE ${filters.join(" AND ")}
    ORDER BY version DESC
    `,
    params
  );

  if (result.rowCount === 0) return { ok: false, error: "PROCESS_DEF_NOT_FOUND", status: 404 };
  for (const row of result.rows) {
    const eligible = processRuntimeEligibility(row);
    if (eligible.ok) return { ok: true, definition: row };
  }
  const first = result.rows[0];
  const eligibility = processRuntimeEligibility(first);
  return {
    ok: false,
    error: eligibility.error,
    lifecycle_status: eligibility.lifecycle,
    status: 409,
  };
}

async function resolvePublishedBinding(app, tenantId, body) {
  const serviceObjectId = String(body?.service_object_id || "").trim();
  if (!serviceObjectId) return { ok: false, error: "SERVICE_OBJECT_REQUIRED", status: 400 };
  const taskType = String(body?.task_type || "").trim() || null;

  const result = await app.db.query(
    `
    SELECT
      pd.id,
      pd.code,
      pd.version,
      pd.is_active,
      pd.attrs,
      pb.priority,
      pb.task_type
    FROM eip_core.service_object so
    JOIN eip_core.process_binding pb
      ON pb.tenant_id=so.tenant_id
     AND pb.service_object_type=so.object_type
     AND pb.is_active=true
    JOIN eip_core.process_def pd
      ON pd.tenant_id=pb.tenant_id
     AND pd.id=pb.process_def_id
    WHERE so.tenant_id=$1
      AND so.id=$2
      AND ($3::text IS NULL OR pb.task_type=$3 OR pb.task_type IS NULL)
    ORDER BY
      CASE
        WHEN $3::text IS NULL THEN 0
        WHEN pb.task_type=$3 THEN 0
        WHEN pb.task_type IS NULL THEN 1
        ELSE 2
      END ASC,
      pb.priority ASC,
      pd.version DESC
    `,
    [tenantId, serviceObjectId, taskType]
  );

  if (result.rowCount === 0) return { ok: false, error: "PROCESS_BINDING_NOT_FOUND", status: 404 };
  for (const row of result.rows) {
    const eligible = processRuntimeEligibility(row);
    if (eligible.ok) return { ok: true, definition: row };
  }
  return { ok: false, error: "PROCESS_BINDING_NOT_PUBLISHED", status: 409 };
}

async function guardProcessStart(app, req, reply, session) {
  const body = req.body || {};
  let resolved = null;

  if (body.process_def_id) {
    const definition = await loadDefinition(app, session.tenant_id, body.process_def_id);
    if (!definition) return sendError(reply, 404, "PROCESS_DEF_NOT_FOUND");
    const eligibility = processRuntimeEligibility(definition);
    if (!eligibility.ok) {
      return sendError(reply, 409, eligibility.error, {
        lifecycle_status: eligibility.lifecycle,
      });
    }
    return null;
  }

  if (body.code) {
    resolved = await resolvePublishedByCode(app, session.tenant_id, body);
  } else {
    resolved = await resolvePublishedBinding(app, session.tenant_id, body);
  }

  if (!resolved.ok) {
    return sendError(reply, resolved.status || 409, resolved.error, {
      ...(resolved.lifecycle_status ? { lifecycle_status: resolved.lifecycle_status } : {}),
    });
  }

  // Force the legacy engine path onto the exact server-selected published version.
  // The browser never gets authority to select an unpublished definition implicitly.
  req.body.process_def_id = resolved.definition.id;
  return null;
}

function addLifecycleProjection(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const attrs = item.attrs && typeof item.attrs === "object" ? item.attrs : {};
  const lifecycle = resolveProcessLifecycle(attrs);
  item.lifecycle_status = lifecycle;
  item.is_published = lifecycle === PROCESS_LIFECYCLE.PUBLISHED;
  item.is_archived = lifecycle === PROCESS_LIFECYCLE.ARCHIVED;
  return item;
}

export function projectProcessStudioPayload(path, method, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;

  if (isProcessPath(path, "defs/[0-9a-f-]{36}/validate") && method === "POST") {
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    payload.issues = projectProcessValidationIssues(errors);
  }
  if (isProcessPath(path, "defs/[0-9a-f-]{36}/publish") && method === "POST") {
    const errors = Array.isArray(payload.details) ? payload.details : [];
    if (errors.length) payload.issues = projectProcessValidationIssues(errors);
  }

  if (Array.isArray(payload.items) && isProcessPath(path, "(?:defs|workbench/catalog)")) {
    payload.items = payload.items.map((item) => addLifecycleProjection(item));
  }
  if (payload.item && (
    isProcessPath(path, "defs/[0-9a-f-]{36}") ||
    isProcessPath(path, "workbench/defs/[0-9a-f-]{36}") ||
    isProcessPath(path, "defs/[0-9a-f-]{36}/publish")
  )) {
    payload.item = addLifecycleProjection(payload.item);
  }

  return payload;
}

export async function processStudioLifecyclePreHandler(app, req, reply) {
  const path = pathOnly(req);
  const method = String(req.method || "GET").toUpperCase();

  const relevantMutation =
    (method === "POST" && isProcessPath(path, "defs")) ||
    (method === "PATCH" && isProcessPath(path, "defs/[0-9a-f-]{36}")) ||
    ((method === "POST" || method === "PATCH") && isProcessPath(path, "task-templates(?:/[0-9a-f-]{36})?")) ||
    ((method === "POST" || method === "PATCH") && isProcessPath(path, "bindings(?:/[0-9a-f-]{36})?")) ||
    (method === "POST" && isProcessPath(path, "instances"));

  if (!relevantMutation) return;
  const session = await requireSessionIfPresent(app, req);
  if (!session) return;

  if (method === "POST" && isProcessPath(path, "defs")) {
    return guardDefinitionWrite(app, req, reply, session, null);
  }
  if (method === "PATCH" && isProcessPath(path, "defs/[0-9a-f-]{36}")) {
    const match = path.match(/\/process\/defs\/([0-9a-f-]{36})$/i);
    return guardDefinitionWrite(app, req, reply, session, match?.[1] || null);
  }
  if ((method === "POST" || method === "PATCH") && path.includes("/process/task-templates")) {
    return guardTaskTemplateWrite(app, req, reply, session, path);
  }
  if ((method === "POST" || method === "PATCH") && path.includes("/process/bindings")) {
    return guardBindingWrite(app, req, reply, session, path);
  }
  if (method === "POST" && isProcessPath(path, "instances")) {
    return guardProcessStart(app, req, reply, session);
  }
}

async function processStudioLifecycleGuard(app) {
  app.addHook("preHandler", async (req, reply) => {
    await processStudioLifecyclePreHandler(app, req, reply);
  });

  app.addHook("onSend", async (req, _reply, payload) => {
    const path = pathOnly(req);
    if (!path.includes("/process/")) return payload;
    if (typeof payload !== "string") return payload;

    try {
      const parsed = JSON.parse(payload);
      const projected = projectProcessStudioPayload(
        path,
        String(req.method || "GET").toUpperCase(),
        parsed
      );
      return JSON.stringify(projected);
    } catch {
      return payload;
    }
  });
}

export default fp(processStudioLifecycleGuard, {
  name: "process-studio-lifecycle-guard",
  dependencies: ["auth-shell", "db"],
});
