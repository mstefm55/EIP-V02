import { getConnectionProfile } from "../services/connections/connectionProfile.js";

const READ_PERMISSIONS = Object.freeze(["OWNER_ADMIN_CONNECTION_READ"]);
const LIVE_INBOUND_MODES = new Set(["none", "api_key", "hmac_signature"]);

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

function buildEndpointProjection({ origin, tenantCode, profile }) {
  const suffix = text(profile?.inbound?.inbound_path_suffix);
  const direction = text(profile?.identity?.direction).toLowerCase();
  const channel = text(profile?.routing?.channel).toLowerCase();
  const verificationMode = text(profile?.verification?.mode).toLowerCase();
  const inboundConfigured = ["inbound", "both"].includes(direction) && Boolean(suffix);
  const base = origin ? origin.replace(/\/$/, "") : "";

  return {
    tenant_code: tenantCode,
    connection_code: profile?.identity?.connection_code || null,
    inbound_path_suffix: suffix || null,
    channel: channel || null,
    verification_mode: verificationMode || null,
    runtime_available: inboundConfigured && LIVE_INBOUND_MODES.has(verificationMode),
    runtime_status: LIVE_INBOUND_MODES.has(verificationMode)
      ? "AVAILABLE"
      : verificationMode === "oauth2_jwt"
        ? "OAUTH2_JWT_RUNTIME_PENDING"
        : "VERIFICATION_MODE_UNSUPPORTED",
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
    getConnectionProfile,
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

export { LIVE_INBOUND_MODES, READ_PERMISSIONS, buildEndpointProjection, requestOrigin };
