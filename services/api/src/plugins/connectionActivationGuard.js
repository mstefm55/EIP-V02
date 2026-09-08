import fp from "fastify-plugin";
import {
  ConnectionProfileError,
  getConnectionProfile,
  mergeEditableProfile,
  normalizeProfile,
} from "../services/connections/connectionProfile.js";
import { assertUniqueInboundPath } from "../services/connections/connectionProfileGuard.js";
import { withTenantTransaction } from "../db/tenantTransaction.js";
import { listSecretStatuses } from "../services/connections/connectionSecretStore.js";
import { validateConnectionActivation } from "../services/connections/connectionActivation.js";

const WRITE_PERMISSIONS = Object.freeze(["OWNER_ADMIN_CONNECTION_WRITE"]);
const CREATE_PATH = /^\/api\/eip\/owner-admin\/connections\/?$/;
const UPDATE_PATH = /^\/api\/eip\/owner-admin\/connections\/([^/?]+)\/?$/;

function requestPath(req) {
  return String(req?.raw?.url || "").split("?")[0];
}

function sendAuthFailure(reply, result) {
  return reply.code(result?.status || 403).send({
    ok: false,
    error: result?.error || "FORBIDDEN",
    ...(Array.isArray(result?.required_permissions)
      ? { required_permissions: result.required_permissions }
      : {}),
  });
}

function sendProfileError(reply, error) {
  const body = {
    ok: false,
    error: error?.code || "CONNECTION_REQUEST_INVALID",
  };
  if (Array.isArray(error?.errors) && error.errors.length > 0) {
    body.errors = error.errors.slice(0, 50).map((entry) => ({
      path: String(entry?.path || "").trim() || null,
      code: String(entry?.code || "INVALID").trim() || "INVALID",
      message: String(entry?.message || "Invalid value.").trim().slice(0, 300),
    }));
  }
  return reply.code(Number.isInteger(error?.status) ? error.status : 400).send(body);
}

async function requireWriteContext(app, req, reply) {
  const authz = await app.requirePermission(req, WRITE_PERMISSIONS, { realm: "EIP" });
  if (!authz.ok) {
    sendAuthFailure(reply, authz);
    return null;
  }
  const csrf = await app.requireCsrf(req);
  if (!csrf.ok) {
    sendAuthFailure(reply, csrf);
    return null;
  }
  return authz.session;
}

export default fp(async function connectionActivationGuard(app) {
  app.addHook("preHandler", async (req, reply) => {
    const method = String(req.method || "").toUpperCase();
    const path = requestPath(req);
    const isCreate = method === "POST" && CREATE_PATH.test(path);
    const updateMatch = method === "PATCH" ? path.match(UPDATE_PATH) : null;
    if (!isCreate && !updateMatch) return;

    const session = await requireWriteContext(app, req, reply);
    if (!session) return reply;

    try {
      if (isCreate) {
        const profile = normalizeProfile(req.body || {});
        if (profile.identity?.is_enabled === true) {
          throw new ConnectionProfileError(
            "Connections must be created as disabled drafts before activation.",
            "CONNECTION_CREATE_ENABLED_FORBIDDEN",
            400,
            [
              {
                path: "identity.is_enabled",
                code: "CONNECTION_CREATE_ENABLED_FORBIDDEN",
                message: "Create the connection as disabled, configure credentials, then enable it.",
              },
            ]
          );
        }
        await assertUniqueInboundPath(app.db, session.tenant_id, profile);
        return;
      }

      const connectionCode = decodeURIComponent(updateMatch[1]);
      const current = await getConnectionProfile(app.db, session.tenant_id, connectionCode);
      if (!current || current.setting_status === "deprecated") {
        throw new ConnectionProfileError("Connection profile was not found.", "CONNECTION_NOT_FOUND", 404);
      }

      const merged = mergeEditableProfile(current, req.body || {});
      await assertUniqueInboundPath(app.db, session.tenant_id, merged);

      if (merged.identity?.is_enabled === true) {
        const credentialStatuses = await withTenantTransaction(
          app.db,
          session.tenant_id,
          (client) => listSecretStatuses(client, session.tenant_id, connectionCode)
        );
        const errors = validateConnectionActivation(merged, credentialStatuses);
        if (errors.length > 0) {
          throw new ConnectionProfileError(
            "Connection activation requirements are not met.",
            "CONNECTION_ACTIVATION_BLOCKED",
            400,
            errors
          );
        }
      }
    } catch (error) {
      if (error instanceof ConnectionProfileError) {
        return sendProfileError(reply, error);
      }
      req.log.error({
        event: "connection_activation_guard_error",
        code: error?.code || error?.name || "ERROR",
      });
      return reply.code(500).send({ ok: false, error: "CONNECTION_SERVICE_UNAVAILABLE" });
    }
  });
});

export { CREATE_PATH, UPDATE_PATH, WRITE_PERMISSIONS };
