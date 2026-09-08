import { withTenantTransaction } from "../db/tenantTransaction.js";
import { joinBaseAndPath, OutboundHttpPolicyError, probeOutboundUrl } from "../security/outboundHttpPolicy.js";
import {
  ConnectionProfileError,
  createConnectionProfile,
  getConnectionProfile,
  listConnectionProfiles,
  updateConnectionHealth,
  updateConnectionProfile,
} from "../services/connections/connectionProfile.js";
import {
  ConnectionInputPolicyError,
  assertConnectionProfileInputSafe,
} from "../services/connections/connectionInputPolicy.js";
import {
  ConnectionSecretError,
  listSecretStatuses,
  revokeSecret,
  rotateSecret,
} from "../services/connections/connectionSecretStore.js";
import { generateConnectionApiKey } from "../services/connections/connectionApiKey.js";
import { deprecateConnectionProfile } from "../services/connections/connectionLifecycle.js";
import {
  loadConnectionTaxonomy,
  publicConnectionTaxonomy,
} from "../services/connections/connectionTaxonomy.js";
import {
  toConnectionDetailDto,
  toConnectionSummaryDto,
} from "../services/connections/connectionDto.js";

const READ_PERMISSIONS = Object.freeze(["OWNER_ADMIN_CONNECTION_READ"]);
const PROFILE_WRITE_PERMISSIONS = Object.freeze(["OWNER_ADMIN_CONNECTION_WRITE"]);
const SECURITY_WRITE_PERMISSIONS = Object.freeze(["OWNER_ADMIN_CONNECTION_SECRET_MANAGE"]);
const TEST_PERMISSIONS = Object.freeze(["OWNER_ADMIN_CONNECTION_TEST"]);
const SECRET_ASSURANCE = new Set(["otp", "totp"]);
const DEFAULT_SECRET_STEP_UP_MIN = 10;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sendAuthFailure(reply, result) {
  const body = { ok: false, error: result?.error || "FORBIDDEN" };
  if (Array.isArray(result?.required_permissions) && result.required_permissions.length > 0) {
    body.required_permissions = result.required_permissions;
  }
  return reply.code(result?.status || 403).send(body);
}

async function requireConnectionPermission(app, req, reply, permissionCodes, { csrf = false } = {}) {
  const authz = await app.requirePermission(req, permissionCodes, { realm: "EIP" });
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

function requireFreshSecretAssurance(session, config = {}, now = Date.now()) {
  const assurance = normalizeText(session?.attrs?.assurance).toLowerCase();
  if (!SECRET_ASSURANCE.has(assurance)) {
    return { ok: false, status: 403, error: "STEP_UP_REQUIRED" };
  }

  const issuedAt = new Date(session?.issued_at || 0);
  const issuedAtMs = issuedAt.getTime();
  const windowMinutes = parsePositiveInteger(
    config.CONNECTION_SECRET_STEP_UP_MIN,
    DEFAULT_SECRET_STEP_UP_MIN
  );
  if (!Number.isFinite(issuedAtMs) || now - issuedAtMs > windowMinutes * 60 * 1000) {
    return { ok: false, status: 403, error: "STEP_UP_REQUIRED" };
  }

  return { ok: true };
}

function mapConnectionError(error) {
  if (
    error instanceof ConnectionProfileError
    || error instanceof ConnectionInputPolicyError
    || error instanceof ConnectionSecretError
    || error instanceof OutboundHttpPolicyError
  ) {
    const response = {
      status: Number.isInteger(error.status) ? error.status : 400,
      body: { ok: false, error: error.code || "CONNECTION_REQUEST_INVALID" },
    };
    if (Array.isArray(error.errors) && error.errors.length > 0) {
      response.body.errors = error.errors.slice(0, 50).map((entry) => ({
        path: normalizeText(entry?.path) || null,
        code: normalizeText(entry?.code) || "INVALID",
        message: normalizeText(entry?.message).slice(0, 300) || "Invalid value.",
      }));
    }
    if (error instanceof ConnectionInputPolicyError && error.path) {
      response.body.path = normalizeText(error.path).slice(0, 300);
    }
    return response;
  }

  return {
    status: 500,
    body: { ok: false, error: "CONNECTION_SERVICE_UNAVAILABLE" },
  };
}

function profileBodySchema() {
  return {
    type: "object",
    maxProperties: 32,
    additionalProperties: true,
  };
}

function connectionCodeParamsSchema(includeSecretKind = false) {
  const properties = {
    code: { type: "string", minLength: 2, maxLength: 64 },
  };
  const required = ["code"];
  if (includeSecretKind) {
    properties.kind = { type: "string", minLength: 2, maxLength: 64 };
    required.push("kind");
  }
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

function buildDependencies(overrides = {}) {
  return {
    createConnectionProfile,
    getConnectionProfile,
    listConnectionProfiles,
    updateConnectionHealth,
    updateConnectionProfile,
    deprecateConnectionProfile,
    assertConnectionProfileInputSafe,
    generateConnectionApiKey,
    listSecretStatuses,
    revokeSecret,
    rotateSecret,
    loadConnectionTaxonomy,
    publicConnectionTaxonomy,
    toConnectionDetailDto,
    toConnectionSummaryDto,
    joinBaseAndPath,
    probeOutboundUrl,
    withTenantTransaction,
    ...overrides,
  };
}

export default async function connectionRoutes(app, options = {}) {
  const deps = buildDependencies(options.services);

  app.get("/owner-admin/connections/taxonomy", async (req, reply) => {
    const session = await requireConnectionPermission(app, req, reply, READ_PERMISSIONS);
    if (!session) return;

    try {
      const taxonomy = await deps.loadConnectionTaxonomy(app.db);
      return reply.send({ ok: true, taxonomy: deps.publicConnectionTaxonomy(taxonomy) });
    } catch (error) {
      req.log.error({ event: "connection_taxonomy_error", code: error?.code || error?.name || "ERROR" });
      return reply.code(503).send({ ok: false, error: "CONNECTION_TAXONOMY_UNAVAILABLE" });
    }
  });

  app.get("/owner-admin/connections", async (req, reply) => {
    const session = await requireConnectionPermission(app, req, reply, READ_PERMISSIONS);
    if (!session) return;

    try {
      const items = await deps.listConnectionProfiles(app.db, session.tenant_id);
      return reply.send({ ok: true, items: items.map(deps.toConnectionSummaryDto) });
    } catch (error) {
      req.log.error({ event: "connection_list_error", code: error?.code || error?.name || "ERROR" });
      return reply.code(500).send({ ok: false, error: "CONNECTION_SERVICE_UNAVAILABLE" });
    }
  });

  app.post(
    "/owner-admin/connections",
    { schema: { body: profileBodySchema() } },
    async (req, reply) => {
      const session = await requireConnectionPermission(
        app,
        req,
        reply,
        PROFILE_WRITE_PERMISSIONS,
        { csrf: true }
      );
      if (!session) return;

      try {
        deps.assertConnectionProfileInputSafe(req.body || {});
        const taxonomy = await deps.loadConnectionTaxonomy(app.db);
        const item = await deps.createConnectionProfile(app.db, session.tenant_id, req.body || {}, taxonomy);
        return reply.code(201).send({ ok: true, item: deps.toConnectionDetailDto(item, {}) });
      } catch (error) {
        const mapped = mapConnectionError(error);
        if (mapped.status >= 500) {
          req.log.error({ event: "connection_create_error", code: error?.code || error?.name || "ERROR" });
        }
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.get(
    "/owner-admin/connections/:code",
    { schema: { params: connectionCodeParamsSchema() } },
    async (req, reply) => {
      const session = await requireConnectionPermission(app, req, reply, READ_PERMISSIONS);
      if (!session) return;

      try {
        const item = await deps.getConnectionProfile(app.db, session.tenant_id, req.params.code);
        if (!item || item.setting_status === "deprecated") {
          return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        }
        const secretStatus = await deps.withTenantTransaction(app.db, session.tenant_id, (client) =>
          deps.listSecretStatuses(client, session.tenant_id, req.params.code)
        );
        return reply.send({ ok: true, item: deps.toConnectionDetailDto(item, secretStatus) });
      } catch (error) {
        const mapped = mapConnectionError(error);
        if (mapped.status >= 500) {
          req.log.error({ event: "connection_detail_error", code: error?.code || error?.name || "ERROR" });
        }
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.patch(
    "/owner-admin/connections/:code",
    {
      schema: {
        params: connectionCodeParamsSchema(),
        body: profileBodySchema(),
      },
    },
    async (req, reply) => {
      const session = await requireConnectionPermission(
        app,
        req,
        reply,
        PROFILE_WRITE_PERMISSIONS,
        { csrf: true }
      );
      if (!session) return;

      try {
        deps.assertConnectionProfileInputSafe(req.body || {});
        const taxonomy = await deps.loadConnectionTaxonomy(app.db);
        const item = await deps.updateConnectionProfile(
          app.db,
          session.tenant_id,
          req.params.code,
          req.body || {},
          taxonomy,
          {
            loadCredentialStatuses: (client, tenantId, connectionCode) =>
              deps.listSecretStatuses(client, tenantId, connectionCode),
          }
        );
        const secretStatus = await deps.withTenantTransaction(app.db, session.tenant_id, (client) =>
          deps.listSecretStatuses(client, session.tenant_id, req.params.code)
        );
        return reply.send({ ok: true, item: deps.toConnectionDetailDto(item, secretStatus) });
      } catch (error) {
        const mapped = mapConnectionError(error);
        if (mapped.status >= 500) {
          req.log.error({ event: "connection_update_error", code: error?.code || error?.name || "ERROR" });
        }
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.delete(
    "/owner-admin/connections/:code",
    { schema: { params: connectionCodeParamsSchema() } },
    async (req, reply) => {
      const session = await requireConnectionPermission(
        app,
        req,
        reply,
        PROFILE_WRITE_PERMISSIONS,
        { csrf: true }
      );
      if (!session) return;

      try {
        const item = await deps.deprecateConnectionProfile(
          app.db,
          session.tenant_id,
          req.params.code,
          session.identity_id
        );
        return reply.send({ ok: true, item });
      } catch (error) {
        const mapped = mapConnectionError(error);
        if (mapped.status >= 500) {
          req.log.error({ event: "connection_delete_error", code: error?.code || error?.name || "ERROR" });
        }
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.get(
    "/owner-admin/connections/:code/secrets",
    { schema: { params: connectionCodeParamsSchema() } },
    async (req, reply) => {
      const session = await requireConnectionPermission(app, req, reply, SECURITY_WRITE_PERMISSIONS);
      if (!session) return;

      try {
        const profile = await deps.getConnectionProfile(app.db, session.tenant_id, req.params.code);
        if (!profile || profile.setting_status === "deprecated") {
          return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        }
        const items = await deps.withTenantTransaction(app.db, session.tenant_id, (client) =>
          deps.listSecretStatuses(client, session.tenant_id, req.params.code)
        );
        return reply.send({ ok: true, items });
      } catch (error) {
        const mapped = mapConnectionError(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.post(
    "/owner-admin/connections/:code/api-key/generate",
    { schema: { params: connectionCodeParamsSchema() } },
    async (req, reply) => {
      const session = await requireConnectionPermission(
        app,
        req,
        reply,
        SECURITY_WRITE_PERMISSIONS,
        { csrf: true }
      );
      if (!session) return;
      const assurance = requireFreshSecretAssurance(session, app.config);
      if (!assurance.ok) return reply.code(assurance.status).send({ ok: false, error: assurance.error });

      try {
        const generated = await deps.withTenantTransaction(app.db, session.tenant_id, (client) =>
          deps.generateConnectionApiKey({
            client,
            tenantId: session.tenant_id,
            connectionCode: req.params.code,
            actorIdentityId: session.identity_id,
            config: app.config,
          })
        );
        return reply.send({
          ok: true,
          api_key: generated.secret,
          raw_key: generated.value,
          shown_once: true,
        });
      } catch (error) {
        const mapped = mapConnectionError(error);
        if (mapped.status >= 500) {
          req.log.error({ event: "connection_api_key_generate_error", code: error?.code || error?.name || "ERROR" });
        }
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.post(
    "/owner-admin/connections/:code/secrets/:kind/rotate",
    {
      schema: {
        params: connectionCodeParamsSchema(true),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["value"],
          properties: {
            value: { type: "string", minLength: 1, maxLength: 16384 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = await requireConnectionPermission(
        app,
        req,
        reply,
        SECURITY_WRITE_PERMISSIONS,
        { csrf: true }
      );
      if (!session) return;
      const assurance = requireFreshSecretAssurance(session, app.config);
      if (!assurance.ok) return reply.code(assurance.status).send({ ok: false, error: assurance.error });

      try {
        const status = await deps.withTenantTransaction(app.db, session.tenant_id, (client) =>
          deps.rotateSecret({
            client,
            tenantId: session.tenant_id,
            connectionCode: req.params.code,
            secretKind: req.params.kind,
            plaintext: req.body.value,
            actorIdentityId: session.identity_id,
            config: app.config,
          })
        );
        return reply.send({ ok: true, secret: status });
      } catch (error) {
        const mapped = mapConnectionError(error);
        if (mapped.status >= 500) {
          req.log.error({ event: "connection_secret_rotate_error", code: error?.code || error?.name || "ERROR" });
        }
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.post(
    "/owner-admin/connections/:code/secrets/:kind/revoke",
    { schema: { params: connectionCodeParamsSchema(true) } },
    async (req, reply) => {
      const session = await requireConnectionPermission(
        app,
        req,
        reply,
        SECURITY_WRITE_PERMISSIONS,
        { csrf: true }
      );
      if (!session) return;
      const assurance = requireFreshSecretAssurance(session, app.config);
      if (!assurance.ok) return reply.code(assurance.status).send({ ok: false, error: assurance.error });

      try {
        const status = await deps.withTenantTransaction(app.db, session.tenant_id, (client) =>
          deps.revokeSecret({
            client,
            tenantId: session.tenant_id,
            connectionCode: req.params.code,
            secretKind: req.params.kind,
            actorIdentityId: session.identity_id,
          })
        );
        return reply.send({ ok: true, secret: status });
      } catch (error) {
        const mapped = mapConnectionError(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.get(
    "/owner-admin/connections/:code/health",
    { schema: { params: connectionCodeParamsSchema() } },
    async (req, reply) => {
      const session = await requireConnectionPermission(app, req, reply, READ_PERMISSIONS);
      if (!session) return;

      try {
        const item = await deps.getConnectionProfile(app.db, session.tenant_id, req.params.code);
        if (!item || item.setting_status === "deprecated") {
          return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        }
        const detail = deps.toConnectionDetailDto(item, {});
        return reply.send({ ok: true, health: detail.health || {} });
      } catch (error) {
        const mapped = mapConnectionError(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.post(
    "/owner-admin/connections/:code/test",
    { schema: { params: connectionCodeParamsSchema() } },
    async (req, reply) => {
      const session = await requireConnectionPermission(app, req, reply, TEST_PERMISSIONS, { csrf: true });
      if (!session) return;

      let profile;
      try {
        profile = await deps.getConnectionProfile(app.db, session.tenant_id, req.params.code);
        if (!profile || profile.setting_status === "deprecated") {
          return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        }

        const baseUrl = normalizeText(profile.outbound?.base_url);
        if (!baseUrl) {
          return reply.code(400).send({ ok: false, error: "CONNECTION_TEST_URL_REQUIRED" });
        }
        const target = deps.joinBaseAndPath(baseUrl, profile.outbound?.healthcheck_path || "");
        const result = await deps.probeOutboundUrl(target, {
          method: profile.outbound?.test_request_method || "HEAD",
          timeoutMs: Math.min(5000, parsePositiveInteger(profile.outbound?.timeout_ms, 5000)),
        });
        const nowIso = new Date().toISOString();
        const health = {
          status: result.ok ? "healthy" : "degraded",
          last_test_at: nowIso,
          last_successful_test_at: result.ok ? nowIso : profile.health?.last_successful_test_at || null,
          status_code: result.status_code,
          latency_ms: result.latency_ms,
        };
        await deps.updateConnectionHealth(app.db, session.tenant_id, req.params.code, health);
        return reply.send({ ok: true, result: { ...result, tested_at: nowIso } });
      } catch (error) {
        const mapped = mapConnectionError(error);
        const nowIso = new Date().toISOString();
        if (profile) {
          await deps.updateConnectionHealth(app.db, session.tenant_id, req.params.code, {
            status: "unhealthy",
            last_test_at: nowIso,
            last_error_code: mapped.body.error,
          }).catch(() => undefined);
        }
        if (mapped.status >= 500) {
          req.log.error({ event: "connection_test_error", code: error?.code || error?.name || "ERROR" });
        }
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );
}

export {
  READ_PERMISSIONS,
  PROFILE_WRITE_PERMISSIONS,
  SECURITY_WRITE_PERMISSIONS,
  TEST_PERMISSIONS,
  mapConnectionError,
  requireFreshSecretAssurance,
};
