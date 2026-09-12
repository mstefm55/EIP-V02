import {
  PROCESS_LIFECYCLE,
  buildProcessArchivedAttrs,
  buildProcessDraftAttrs,
  resolveProcessLifecycle,
} from "../../services/process/processDefinitionLifecycle.js";

const DEF_WRITE = ["PROCESS_DEF_WRITE", "CRM_PROCESS_DEF_WRITE"];

function normalizeText(value) {
  return String(value || "").trim();
}

async function requireWrite(app, req, reply) {
  const authz = await app.requirePermission(req, DEF_WRITE, { realm: "EIP" });
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
  return authz.session;
}

async function loadDefinitionForUpdate(client, tenantId, id) {
  const result = await client.query(
    `
    SELECT id, tenant_id, code, name, version, is_active, graph, attrs, created_at, updated_at
    FROM eip_core.process_def
    WHERE tenant_id=$1 AND id=$2
    FOR UPDATE
    `,
    [tenantId, id]
  );
  return result.rows[0] || null;
}

export default async function processStudioLifecycleRoutes(app) {
  app.post(
    "/process/defs/:id/revisions",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: {
            id: { type: "string", minLength: 36, maxLength: 36 },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            clone_bindings: { type: "boolean" },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireWrite(app, req, reply);
      if (!session) return;

      const client = await app.db.connect();
      try {
        await client.query("BEGIN");
        const source = await loadDefinitionForUpdate(client, session.tenant_id, req.params.id);
        if (!source) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
        }

        const lifecycle = resolveProcessLifecycle(source.attrs || {});
        if (lifecycle !== PROCESS_LIFECYCLE.PUBLISHED) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            ok: false,
            error: lifecycle === PROCESS_LIFECYCLE.ARCHIVED
              ? "PROCESS_DEF_ARCHIVED"
              : "PROCESS_DEF_NOT_PUBLISHED",
            lifecycle_status: lifecycle,
          });
        }

        // Serialize revision numbering by tenant + process code without a new table.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
          [String(session.tenant_id), String(source.code)]
        );

        const versionResult = await client.query(
          `
          SELECT COALESCE(max(version), 0)::int AS max_version
          FROM eip_core.process_def
          WHERE tenant_id=$1 AND code=$2
          `,
          [session.tenant_id, source.code]
        );
        const nextVersion = Number(versionResult.rows[0]?.max_version || 0) + 1;
        const revisionAttrs = buildProcessDraftAttrs(source.attrs || {}, {
          revision_of_process_def_id: source.id,
          revision_of_version: source.version,
        });
        revisionAttrs.revision_created_by_identity_id = String(session.identity_id);
        revisionAttrs.revision_created_at = new Date().toISOString();

        const insertResult = await client.query(
          `
          INSERT INTO eip_core.process_def
            (tenant_id, code, name, version, is_active, graph, attrs)
          VALUES
            ($1,$2,$3,$4,true,$5::jsonb,$6::jsonb)
          RETURNING id, code, name, version, is_active, graph, attrs, created_at, updated_at
          `,
          [
            session.tenant_id,
            source.code,
            source.name,
            nextVersion,
            JSON.stringify(source.graph || {}),
            JSON.stringify(revisionAttrs),
          ]
        );
        const revision = insertResult.rows[0];

        const templateResult = await client.query(
          `
          INSERT INTO eip_core.task_template
            (tenant_id, process_def_id, service_object_type, task_type, title, description,
             is_active, sort_order, attrs)
          SELECT
            tenant_id, $3::uuid, service_object_type, task_type, title, description,
            is_active, sort_order, attrs
          FROM eip_core.task_template
          WHERE tenant_id=$1 AND process_def_id=$2
          RETURNING id
          `,
          [session.tenant_id, source.id, revision.id]
        );

        let clonedBindings = 0;
        if (req.body?.clone_bindings !== false) {
          const bindingResult = await client.query(
            `
            INSERT INTO eip_core.process_binding
              (tenant_id, service_object_type, process_def_id, task_type, is_active, priority, attrs)
            SELECT
              tenant_id,
              service_object_type,
              $3::uuid,
              task_type,
              false,
              priority,
              CASE
                WHEN is_active=true
                  THEN COALESCE(attrs, '{}'::jsonb) || jsonb_build_object('_studio_activate_on_publish', true)
                ELSE COALESCE(attrs, '{}'::jsonb) - '_studio_activate_on_publish'
              END
            FROM eip_core.process_binding
            WHERE tenant_id=$1 AND process_def_id=$2
            RETURNING id
            `,
            [session.tenant_id, source.id, revision.id]
          );
          clonedBindings = bindingResult.rowCount;
        }

        await client.query("COMMIT");
        return reply.code(201).send({
          ok: true,
          item: revision,
          revision_of: {
            process_def_id: source.id,
            version: source.version,
          },
          cloned: {
            task_templates: templateResult.rowCount,
            bindings: clonedBindings,
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        if (error?.code === "23505") {
          return reply.code(409).send({ ok: false, error: "PROCESS_REVISION_VERSION_CONFLICT" });
        }
        app.log.error({
          event: "process_studio_revision_create_error",
          tenantId: session.tenant_id,
          processDefId: req.params.id,
          error: error?.message,
        });
        return reply.code(500).send({ ok: false, error: "PROCESS_REVISION_CREATE_FAILED" });
      } finally {
        client.release();
      }
    }
  );

  app.post(
    "/process/defs/:id/archive",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: {
            id: { type: "string", minLength: 36, maxLength: 36 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireWrite(app, req, reply);
      if (!session) return;

      const client = await app.db.connect();
      try {
        await client.query("BEGIN");
        const source = await loadDefinitionForUpdate(client, session.tenant_id, req.params.id);
        if (!source) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
        }

        const lifecycle = resolveProcessLifecycle(source.attrs || {});
        if (lifecycle === PROCESS_LIFECYCLE.ARCHIVED) {
          await client.query("COMMIT");
          return reply.send({ ok: true, item: source, reused: true });
        }

        const nextAttrs = buildProcessArchivedAttrs(source.attrs || {}, {
          archived_by_identity_id: session.identity_id,
        });
        const result = await client.query(
          `
          UPDATE eip_core.process_def
          SET is_active=false,
              attrs=$3::jsonb,
              updated_at=now()
          WHERE tenant_id=$1 AND id=$2
          RETURNING id, code, name, version, is_active, graph, attrs, created_at, updated_at
          `,
          [session.tenant_id, source.id, JSON.stringify(nextAttrs)]
        );

        await client.query(
          `
          UPDATE eip_core.process_binding
          SET is_active=false, updated_at=now()
          WHERE tenant_id=$1 AND process_def_id=$2 AND is_active=true
          `,
          [session.tenant_id, source.id]
        );

        await client.query("COMMIT");
        return reply.send({ ok: true, item: result.rows[0], reused: false });
      } catch (error) {
        await client.query("ROLLBACK");
        app.log.error({
          event: "process_studio_definition_archive_error",
          tenantId: session.tenant_id,
          processDefId: req.params.id,
          error: error?.message,
        });
        return reply.code(500).send({ ok: false, error: normalizeText(error?.message) || "PROCESS_ARCHIVE_FAILED" });
      } finally {
        client.release();
      }
    }
  );
}
