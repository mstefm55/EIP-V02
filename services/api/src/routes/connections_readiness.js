import { withTenantTransaction } from "../db/tenantTransaction.js";
import { getConnectionProfile } from "../services/connections/connectionProfile.js";
import { listSecretStatuses } from "../services/connections/connectionSecretStore.js";
import { buildInboundReadiness } from "../services/connections/connectionReadiness.js";

const TEST_PERMISSIONS = Object.freeze(["OWNER_ADMIN_CONNECTION_TEST"]);

function sendAuthFailure(reply, result) {
  const body = { ok: false, error: result?.error || "FORBIDDEN" };
  if (Array.isArray(result?.required_permissions) && result.required_permissions.length > 0) {
    body.required_permissions = result.required_permissions;
  }
  return reply.code(result?.status || 403).send(body);
}

export default async function connectionReadinessRoutes(app, options = {}) {
  const deps = {
    withTenantTransaction,
    getConnectionProfile,
    listSecretStatuses,
    buildInboundReadiness,
    ...(options.services || {}),
  };

  app.post(
    "/owner-admin/connections/:code/test/inbound-readiness",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: {
            code: { type: "string", minLength: 2, maxLength: 64 },
          },
        },
      },
    },
    async (req, reply) => {
      const authz = await app.requirePermission(req, TEST_PERMISSIONS, { realm: "EIP" });
      if (!authz.ok) return sendAuthFailure(reply, authz);
      const csrf = await app.requireCsrf(req);
      if (!csrf.ok) return sendAuthFailure(reply, csrf);

      const session = authz.session;
      try {
        const profile = await deps.getConnectionProfile(app.db, session.tenant_id, req.params.code);
        if (!profile || profile.setting_status === "deprecated") {
          return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        }

        const credentialStatuses = await deps.withTenantTransaction(
          app.db,
          session.tenant_id,
          (client) => deps.listSecretStatuses(client, session.tenant_id, req.params.code)
        );
        const result = deps.buildInboundReadiness(profile, credentialStatuses);
        return reply.send({ ok: true, result });
      } catch (error) {
        req.log.error({
          event: "connection_inbound_readiness_error",
          code: error?.code || error?.name || "ERROR",
        });
        return reply.code(500).send({ ok: false, error: "CONNECTION_SERVICE_UNAVAILABLE" });
      }
    }
  );
}

export { TEST_PERMISSIONS };
