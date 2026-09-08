import { withTenantTransaction } from "../db/tenantTransaction.js";
import { getConnectionProfile } from "../services/connections/connectionProfile.js";
import { listSecretStatuses } from "../services/connections/connectionSecretStore.js";
import {
  buildInboundReadiness,
  buildOutboundReadiness,
} from "../services/connections/connectionReadiness.js";
import { buildConnectionActivationStatus } from "../services/connections/connectionActivation.js";

const READ_PERMISSIONS = Object.freeze(["OWNER_ADMIN_CONNECTION_READ"]);
const TEST_PERMISSIONS = Object.freeze(["OWNER_ADMIN_CONNECTION_TEST"]);

function sendAuthFailure(reply, result) {
  const body = { ok: false, error: result?.error || "FORBIDDEN" };
  if (Array.isArray(result?.required_permissions) && result.required_permissions.length > 0) {
    body.required_permissions = result.required_permissions;
  }
  return reply.code(result?.status || 403).send(body);
}

function paramsSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["code"],
    properties: {
      code: { type: "string", minLength: 2, maxLength: 64 },
    },
  };
}

async function loadReadinessContext(app, deps, session, code) {
  const profile = await deps.getConnectionProfile(app.db, session.tenant_id, code);
  if (!profile || profile.setting_status === "deprecated") return null;
  const credentialStatuses = await deps.withTenantTransaction(
    app.db,
    session.tenant_id,
    (client) => deps.listSecretStatuses(client, session.tenant_id, code)
  );
  return { profile, credentialStatuses };
}

export default async function connectionReadinessRoutes(app, options = {}) {
  const deps = {
    withTenantTransaction,
    getConnectionProfile,
    listSecretStatuses,
    buildInboundReadiness,
    buildOutboundReadiness,
    buildConnectionActivationStatus,
    ...(options.services || {}),
  };

  app.get(
    "/owner-admin/connections/:code/readiness",
    { schema: { params: paramsSchema() } },
    async (req, reply) => {
      const authz = await app.requirePermission(req, READ_PERMISSIONS, { realm: "EIP" });
      if (!authz.ok) return sendAuthFailure(reply, authz);

      try {
        const context = await loadReadinessContext(app, deps, authz.session, req.params.code);
        if (!context) return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const { profile, credentialStatuses } = context;
        return reply.send({
          ok: true,
          readiness: {
            activation: deps.buildConnectionActivationStatus(profile, credentialStatuses),
            inbound: deps.buildInboundReadiness(profile, credentialStatuses),
            outbound: deps.buildOutboundReadiness(profile, credentialStatuses),
          },
        });
      } catch (error) {
        req.log.error({
          event: "connection_readiness_error",
          code: error?.code || error?.name || "ERROR",
        });
        return reply.code(500).send({ ok: false, error: "CONNECTION_SERVICE_UNAVAILABLE" });
      }
    }
  );

  app.post(
    "/owner-admin/connections/:code/test/inbound-readiness",
    { schema: { params: paramsSchema() } },
    async (req, reply) => {
      const authz = await app.requirePermission(req, TEST_PERMISSIONS, { realm: "EIP" });
      if (!authz.ok) return sendAuthFailure(reply, authz);
      const csrf = await app.requireCsrf(req);
      if (!csrf.ok) return sendAuthFailure(reply, csrf);

      try {
        const context = await loadReadinessContext(app, deps, authz.session, req.params.code);
        if (!context) return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const result = deps.buildInboundReadiness(context.profile, context.credentialStatuses);
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

export { READ_PERMISSIONS, TEST_PERMISSIONS };
