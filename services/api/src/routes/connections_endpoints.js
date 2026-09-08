import { withTenantTransaction } from "../db/tenantTransaction.js";
import { getConnectionProfile } from "../services/connections/connectionProfile.js";
import { listSecretStatuses } from "../services/connections/connectionSecretStore.js";
import { buildInboundReadiness } from "../services/connections/connectionReadiness.js";

const READ_PERMISSIONS = Object.freeze(["OWNER_ADMIN_CONNECTION_READ"]);

function text(value) {
  return String(value ?? "").trim();
}

function sendAuthFailure(reply, result) {
  const body = { ok: false, error: result?.error || "FORBIDDEN" };
  if (Array.isArray(result?.required_permissions) && result.required_permissions.length > 0) {
    body.required_permissions = result.required_permissions;
  }
  return reply.code(result?.status || 403).send(body);
}

function requestOrigin(req) {
  const protocol = text(req?.protocol).toLowerCase();
  const host = text(req?.headers?.host);
  if (!["http", "https"].includes(protocol) || !host || /[\s\\/]/.test(host)) return null;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function buildEndpointProjection({ origin, tenantCode, profile, readiness = {} }) {
  const suffix = text(profile?.inbound?.inbound_path_suffix);
  const direction = text(profile?.identity?.direction).toLowerCase();
  const channel = text(profile?.routing?.channel).toLowerCase();
  const verificationMode = text(profile?.verification?.mode).toLowerCase();
  const inboundConfigured = ["inbound", "both"].includes(direction) && Boolean(suffix);
  const base = origin ? origin.replace(/\/$/, "") : "";

  return {
    tenant_code: tenantCode,
    connection_code: profile?.identity?.connection_code || null,
    connection_enabled: profile?.identity?.is_enabled === true,
    inbound_enabled: profile?.inbound?.webhook_enabled === true,
    inbound_path_suffix: suffix || null,
    channel: channel || null,
    verification_mode: verificationMode || null,
    configuration_ready: readiness?.configured === true,
    activation_ready: readiness?.activation_ready === true,
    runtime_available: readiness?.runtime_available === true,
    runtime_status: readiness?.runtime_status || "CONFIGURATION_INCOMPLETE",
    public_intake_url:
      inboundConfigured && channel !== "edi" && base
        ? `${base}/api/public/gateway/intake/${encodeURIComponent(tenantCode)}/${encodeURIComponent(suffix)}`
        : null,
    edi_webhook_url:
      inboundConfigured && channel === "edi" && base
        ? `${base}/api/edi/gateway/webhook/${encodeURIComponent(tenantCode)}/${encodeURIComponent(suffix)}`
        : null,
  };
}

export default async function connectionEndpointRoutes(app, options = {}) {
  const deps = {
    withTenantTransaction,
    getConnectionProfile,
    listSecretStatuses,
    buildInboundReadiness,
    ...(options.services || {}),
  };

  app.get(
    "/owner-admin/connections/:code/endpoints",
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
      const authz = await app.requirePermission(req, READ_PERMISSIONS, { realm: "EIP" });
      if (!authz.ok) return sendAuthFailure(reply, authz);
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
        const readiness = deps.buildInboundReadiness(profile, credentialStatuses);

        const tenantResult = await app.db.query(
          `
          SELECT tenant_code
          FROM kernel.tenants
          WHERE tenant_id = $1::uuid
            AND tenant_status = 'active'
          LIMIT 1
          `,
          [session.tenant_id]
        );
        if (tenantResult.rowCount !== 1) {
          return reply.code(404).send({ ok: false, error: "TENANT_NOT_FOUND" });
        }

        const endpoints = buildEndpointProjection({
          origin: requestOrigin(req),
          tenantCode: tenantResult.rows[0].tenant_code,
          profile,
          readiness,
        });
        return reply.send({ ok: true, endpoints });
      } catch (error) {
        req.log.error({
          event: "connection_endpoint_projection_error",
          code: error?.code || error?.name || "ERROR",
        });
        return reply.code(500).send({ ok: false, error: "CONNECTION_SERVICE_UNAVAILABLE" });
      }
    }
  );
}

export { READ_PERMISSIONS, buildEndpointProjection, requestOrigin };
