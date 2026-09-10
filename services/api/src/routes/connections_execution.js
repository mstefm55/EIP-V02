import {
  ConnectionOutboundRuntimeError,
  MAX_REQUEST_BODY_BYTES,
  MAX_RESPONSE_BODY_BYTES,
  SUPPORTED_BODY_ENCODINGS,
  SUPPORTED_OUTBOUND_METHODS,
  SUPPORTED_RESPONSE_ENCODINGS,
  planConnectionRequest,
} from "../services/connections/connectionOutboundRuntime.js";
import { SUPPORTED_PROVIDER_SIGNATURES } from "../services/connections/connectionProviderVerification.js";
import { resolveConnectionTargetTenant } from "../services/connections/connectionTargetTenant.js";
import { TEST_PERMISSIONS, READ_PERMISSIONS } from "./connections.js";

const SUPPORTED_OUTBOUND_AUTH_MODES = Object.freeze([
  "none",
  "bearer",
  "api_key_header",
  "api_key_query",
  "basic",
  "oauth2_client_credentials",
]);

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

async function requirePermission(app, req, reply, permissions, { csrf = false } = {}) {
  const authz = await app.requirePermission(req, permissions, { realm: "EIP" });
  if (!authz.ok) {
    sendAuthFailure(reply, authz);
    return null;
  }
  if (csrf) {
    const csrfResult = await app.requireCsrf(req);
    if (!csrfResult.ok) {
      sendAuthFailure(reply, csrfResult);
      return null;
    }
  }
  return authz.session;
}

function requestInputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    maxProperties: 10,
    properties: {
      method: { type: "string", enum: [...SUPPORTED_OUTBOUND_METHODS] },
      path: { type: "string", maxLength: 2048 },
      query: { type: "object", maxProperties: 100, additionalProperties: true },
      headers: { type: "object", maxProperties: 100, additionalProperties: true },
      body: {},
      body_encoding: { type: "string", enum: [...SUPPORTED_BODY_ENCODINGS] },
      content_type: { type: "string", maxLength: 255 },
      accept: { type: "string", maxLength: 255 },
      response_encoding: { type: "string", enum: [...SUPPORTED_RESPONSE_ENCODINGS] },
      idempotency_key: { type: "string", maxLength: 255 },
    },
  };
}

function codeParamsSchema(targeted = false) {
  const properties = {
    code: { type: "string", minLength: 2, maxLength: 64 },
  };
  const required = ["code"];
  if (targeted) {
    properties.tenantCode = { type: "string", minLength: 1, maxLength: 128 };
    required.unshift("tenantCode");
  }
  return { type: "object", additionalProperties: false, required, properties };
}

function capabilityProjection() {
  return {
    transport: "http",
    methods: [...SUPPORTED_OUTBOUND_METHODS],
    request_body_encodings: [...SUPPORTED_BODY_ENCODINGS],
    response_encodings: [...SUPPORTED_RESPONSE_ENCODINGS],
    authentication_modes: [...SUPPORTED_OUTBOUND_AUTH_MODES],
    provider_signature_verifiers: [...SUPPORTED_PROVIDER_SIGNATURES],
    request_input: {
      path: true,
      query: true,
      headers: true,
      body: true,
      content_type: true,
      accept: true,
      idempotency_key: true,
    },
    profile_input: {
      base_url: "outbound.base_url",
      path_prefix: "outbound.path_prefix",
      default_headers: "outbound.default_headers",
      auth_mode: "outbound.auth_mode",
      auth_metadata: "outbound.auth",
      request_defaults: "attrs.outbound_request",
      provider_signature: "attrs.provider_signature",
    },
    limits: {
      max_request_body_bytes: MAX_REQUEST_BODY_BYTES,
      max_response_body_bytes: MAX_RESPONSE_BODY_BYTES,
    },
    credentials: {
      persistence: "encrypted_connection_secret",
      plaintext_in_profile: false,
      plaintext_in_plan_response: false,
    },
  };
}

function mapExecutionError(error) {
  if (error instanceof ConnectionOutboundRuntimeError) {
    return {
      status: Number.isInteger(error.status) ? error.status : 400,
      body: { ok: false, error: error.code || "CONNECTION_REQUEST_INVALID" },
    };
  }
  return { status: 500, body: { ok: false, error: "CONNECTION_SERVICE_UNAVAILABLE" } };
}

export default async function connectionExecutionRoutes(app, options = {}) {
  const deps = {
    planConnectionRequest,
    resolveConnectionTargetTenant,
    ...(options.services || {}),
  };

  app.get("/owner-admin/connections/capabilities", async (req, reply) => {
    const session = await requirePermission(app, req, reply, READ_PERMISSIONS);
    if (!session) return;
    return reply.send({ ok: true, capabilities: capabilityProjection() });
  });

  app.post(
    "/owner-admin/connections/:code/request-plan",
    { schema: { params: codeParamsSchema(false), body: requestInputSchema() } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, TEST_PERMISSIONS, { csrf: true });
      if (!session) return;
      try {
        const result = await deps.planConnectionRequest({
          pool: app.db,
          tenantId: session.tenant_id,
          connectionCode: req.params.code,
          request: req.body || {},
        });
        return reply.send({ ok: true, result });
      } catch (error) {
        const mapped = mapExecutionError(error);
        if (mapped.status >= 500) {
          req.log.error({ event: "connection_request_plan_error", code: error?.code || error?.name || "ERROR" });
        }
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.post(
    "/owner-admin/connections/tenants/:tenantCode/:code/request-plan",
    { schema: { params: codeParamsSchema(true), body: requestInputSchema() } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, TEST_PERMISSIONS, { csrf: true });
      if (!session) return;
      try {
        const target = await deps.resolveConnectionTargetTenant(app.db, req.params.tenantCode);
        if (!target?.id) return reply.code(404).send({ ok: false, error: "TENANT_NOT_FOUND" });
        const result = await deps.planConnectionRequest({
          pool: app.db,
          tenantId: target.id,
          connectionCode: req.params.code,
          request: req.body || {},
        });
        return reply.send({ ok: true, target_tenant: target, result });
      } catch (error) {
        const mapped = mapExecutionError(error);
        if (mapped.status >= 500) {
          req.log.error({
            event: "connection_target_request_plan_error",
            code: error?.code || error?.name || "ERROR",
            tenant_code: text(req.params?.tenantCode).slice(0, 128),
          });
        }
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );
}

export {
  SUPPORTED_OUTBOUND_AUTH_MODES,
  capabilityProjection,
  codeParamsSchema,
  mapExecutionError,
  requestInputSchema,
};
