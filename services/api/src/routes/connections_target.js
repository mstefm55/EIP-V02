import { withTenantTransaction } from "../db/tenantTransaction.js";
import { joinBaseAndPath, OutboundHttpPolicyError, probeOutboundUrl } from "../security/outboundHttpPolicy.js";
import {
  ConnectionProfileError,
  createConnectionProfile,
  getConnectionProfile,
  listConnectionProfiles,
  mergeEditableProfile,
  normalizeProfile,
  updateConnectionHealth,
  updateConnectionProfile,
} from "../services/connections/connectionProfile.js";
import {
  ConnectionInputPolicyError,
  assertConnectionProfileInputSafe,
} from "../services/connections/connectionInputPolicy.js";
import { assertUniqueInboundPath } from "../services/connections/connectionProfileGuard.js";
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
import {
  buildConnectionActivationStatus,
  validateConnectionActivation,
} from "../services/connections/connectionActivation.js";
import {
  buildInboundReadiness,
  buildOutboundReadiness,
} from "../services/connections/connectionReadiness.js";
import {
  listConnectionTargetTenants,
  resolveConnectionTargetTenant,
} from "../services/connections/connectionTargetTenant.js";
import { buildEndpointProjection, requestOrigin } from "./connections_endpoints.js";
import {
  PROFILE_WRITE_PERMISSIONS,
  READ_PERMISSIONS,
  SECURITY_WRITE_PERMISSIONS,
  TEST_PERMISSIONS,
  requireFreshSecretAssurance,
} from "./connections.js";

function text(value) {
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

function mapConnectionError(error) {
  if (
    error instanceof ConnectionProfileError
    || error instanceof ConnectionInputPolicyError
    || error instanceof ConnectionSecretError
    || error instanceof OutboundHttpPolicyError
  ) {
    const body = { ok: false, error: error.code || "CONNECTION_REQUEST_INVALID" };
    if (Array.isArray(error.errors) && error.errors.length > 0) {
      body.errors = error.errors.slice(0, 50).map((entry) => ({
        path: text(entry?.path) || null,
        code: text(entry?.code) || "INVALID",
        message: text(entry?.message).slice(0, 300) || "Invalid value.",
      }));
    }
    if (error instanceof ConnectionInputPolicyError && error.path) {
      body.path = text(error.path).slice(0, 300);
    }
    return { status: Number.isInteger(error.status) ? error.status : 400, body };
  }
  return { status: 500, body: { ok: false, error: "CONNECTION_SERVICE_UNAVAILABLE" } };
}

function tenantParamsSchema(includeCode = false, includeSecretKind = false) {
  const properties = {
    tenantCode: { type: "string", minLength: 1, maxLength: 128 },
  };
  const required = ["tenantCode"];
  if (includeCode) {
    properties.code = { type: "string", minLength: 2, maxLength: 64 };
    required.push("code");
  }
  if (includeSecretKind) {
    properties.kind = { type: "string", minLength: 2, maxLength: 64 };
    required.push("kind");
  }
  return { type: "object", additionalProperties: false, required, properties };
}

function profileBodySchema() {
  return { type: "object", maxProperties: 32, additionalProperties: true };
}

async function resolveTarget(deps, app, req, reply) {
  const target = await deps.resolveConnectionTargetTenant(app.db, req.params.tenantCode);
  if (!target?.id || !target?.code) {
    reply.code(404).send({ ok: false, error: "TENANT_NOT_FOUND" });
    return null;
  }
  return target;
}

async function loadCredentialStatuses(deps, app, tenantId, code) {
  return deps.withTenantTransaction(app.db, tenantId, (client) =>
    deps.listSecretStatuses(client, tenantId, code)
  );
}

async function assertTargetCreateSafe(deps, app, target, body) {
  deps.assertConnectionProfileInputSafe(body || {});
  const profile = deps.normalizeProfile(body || {});
  if (profile.identity?.is_enabled === true) {
    throw new ConnectionProfileError(
      "Connections must be created as disabled drafts before activation.",
      "CONNECTION_CREATE_ENABLED_FORBIDDEN",
      400,
      [{
        path: "identity.is_enabled",
        code: "CONNECTION_CREATE_ENABLED_FORBIDDEN",
        message: "Create the connection as disabled, configure credentials, then enable it.",
      }]
    );
  }
  await deps.assertUniqueInboundPath(app.db, target.id, profile);
}

async function assertTargetUpdateSafe(deps, app, target, code, body) {
  deps.assertConnectionProfileInputSafe(body || {});
  const current = await deps.getConnectionProfile(app.db, target.id, code);
  if (!current || current.setting_status === "deprecated") {
    throw new ConnectionProfileError("Connection profile was not found.", "CONNECTION_NOT_FOUND", 404);
  }
  const merged = deps.mergeEditableProfile(current, body || {});
  await deps.assertUniqueInboundPath(app.db, target.id, merged);
  if (merged.identity?.is_enabled === true) {
    const credentialStatuses = await loadCredentialStatuses(deps, app, target.id, code);
    const errors = deps.validateConnectionActivation(merged, credentialStatuses);
    if (errors.length > 0) {
      throw new ConnectionProfileError(
        "Connection activation requirements are not met.",
        "CONNECTION_ACTIVATION_BLOCKED",
        400,
        errors
      );
    }
  }
}

function buildDependencies(overrides = {}) {
  return {
    withTenantTransaction,
    createConnectionProfile,
    getConnectionProfile,
    listConnectionProfiles,
    mergeEditableProfile,
    normalizeProfile,
    updateConnectionHealth,
    updateConnectionProfile,
    assertConnectionProfileInputSafe,
    assertUniqueInboundPath,
    listSecretStatuses,
    revokeSecret,
    rotateSecret,
    generateConnectionApiKey,
    deprecateConnectionProfile,
    loadConnectionTaxonomy,
    publicConnectionTaxonomy,
    toConnectionDetailDto,
    toConnectionSummaryDto,
    validateConnectionActivation,
    buildConnectionActivationStatus,
    buildInboundReadiness,
    buildOutboundReadiness,
    listConnectionTargetTenants,
    resolveConnectionTargetTenant,
    joinBaseAndPath,
    probeOutboundUrl,
    ...overrides,
  };
}

export default async function connectionTargetRoutes(app, options = {}) {
  const deps = buildDependencies(options.services);

  app.get("/owner-admin/connections/tenants", async (req, reply) => {
    const session = await requirePermission(app, req, reply, READ_PERMISSIONS);
    if (!session) return;
    try {
      const items = await deps.listConnectionTargetTenants(app.db);
      return reply.send({ ok: true, items, authenticated_tenant_id: session.tenant_id });
    } catch (error) {
      req.log.error({ event: "connection_target_tenant_list_error", code: error?.code || error?.name || "ERROR" });
      return reply.code(500).send({ ok: false, error: "CONNECTION_SERVICE_UNAVAILABLE" });
    }
  });

  app.get(
    "/owner-admin/connections/tenants/:tenantCode",
    { schema: { params: tenantParamsSchema() } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, READ_PERMISSIONS);
      if (!session) return;
      try {
        const target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        const items = await deps.listConnectionProfiles(app.db, target.id);
        return reply.send({ ok: true, target_tenant: target, items: items.map(deps.toConnectionSummaryDto) });
      } catch (error) {
        req.log.error({ event: "connection_target_list_error", code: error?.code || error?.name || "ERROR" });
        return reply.code(500).send({ ok: false, error: "CONNECTION_SERVICE_UNAVAILABLE" });
      }
    }
  );

  app.post(
    "/owner-admin/connections/tenants/:tenantCode",
    { schema: { params: tenantParamsSchema(), body: profileBodySchema() } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, PROFILE_WRITE_PERMISSIONS, { csrf: true });
      if (!session) return;
      try {
        const target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        await assertTargetCreateSafe(deps, app, target, req.body || {});
        const taxonomy = await deps.loadConnectionTaxonomy(app.db);
        const item = await deps.createConnectionProfile(app.db, target.id, req.body || {}, taxonomy);
        return reply.code(201).send({ ok: true, target_tenant: target, item: deps.toConnectionDetailDto(item, {}) });
      } catch (error) {
        const mapped = mapConnectionError(error);
        if (mapped.status >= 500) req.log.error({ event: "connection_target_create_error", code: error?.code || error?.name || "ERROR" });
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.get(
    "/owner-admin/connections/tenants/:tenantCode/:code",
    { schema: { params: tenantParamsSchema(true) } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, READ_PERMISSIONS);
      if (!session) return;
      try {
        const target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        const item = await deps.getConnectionProfile(app.db, target.id, req.params.code);
        if (!item || item.setting_status === "deprecated") return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const secretStatus = await loadCredentialStatuses(deps, app, target.id, req.params.code);
        return reply.send({ ok: true, target_tenant: target, item: deps.toConnectionDetailDto(item, secretStatus) });
      } catch (error) {
        const mapped = mapConnectionError(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.patch(
    "/owner-admin/connections/tenants/:tenantCode/:code",
    { schema: { params: tenantParamsSchema(true), body: profileBodySchema() } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, PROFILE_WRITE_PERMISSIONS, { csrf: true });
      if (!session) return;
      try {
        const target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        await assertTargetUpdateSafe(deps, app, target, req.params.code, req.body || {});
        const taxonomy = await deps.loadConnectionTaxonomy(app.db);
        const item = await deps.updateConnectionProfile(
          app.db,
          target.id,
          req.params.code,
          req.body || {},
          taxonomy,
          { loadCredentialStatuses: (client, tenantId, connectionCode) => deps.listSecretStatuses(client, tenantId, connectionCode) }
        );
        const secretStatus = await loadCredentialStatuses(deps, app, target.id, req.params.code);
        return reply.send({ ok: true, target_tenant: target, item: deps.toConnectionDetailDto(item, secretStatus) });
      } catch (error) {
        const mapped = mapConnectionError(error);
        if (mapped.status >= 500) req.log.error({ event: "connection_target_update_error", code: error?.code || error?.name || "ERROR" });
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.delete(
    "/owner-admin/connections/tenants/:tenantCode/:code",
    { schema: { params: tenantParamsSchema(true) } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, PROFILE_WRITE_PERMISSIONS, { csrf: true });
      if (!session) return;
      try {
        const target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        const item = await deps.deprecateConnectionProfile(app.db, target.id, req.params.code, session.identity_id);
        return reply.send({ ok: true, target_tenant: target, item });
      } catch (error) {
        const mapped = mapConnectionError(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.get(
    "/owner-admin/connections/tenants/:tenantCode/:code/secrets",
    { schema: { params: tenantParamsSchema(true) } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, SECURITY_WRITE_PERMISSIONS);
      if (!session) return;
      try {
        const target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        const profile = await deps.getConnectionProfile(app.db, target.id, req.params.code);
        if (!profile || profile.setting_status === "deprecated") return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const items = await loadCredentialStatuses(deps, app, target.id, req.params.code);
        return reply.send({ ok: true, target_tenant: target, items });
      } catch (error) {
        const mapped = mapConnectionError(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.post(
    "/owner-admin/connections/tenants/:tenantCode/:code/api-key/generate",
    { schema: { params: tenantParamsSchema(true) } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, SECURITY_WRITE_PERMISSIONS, { csrf: true });
      if (!session) return;
      const assurance = requireFreshSecretAssurance(session, app.config);
      if (!assurance.ok) return reply.code(assurance.status).send({ ok: false, error: assurance.error });
      try {
        const target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        const generated = await deps.withTenantTransaction(app.db, target.id, (client) =>
          deps.generateConnectionApiKey({
            client,
            tenantId: target.id,
            connectionCode: req.params.code,
            actorIdentityId: session.identity_id,
            config: app.config,
          })
        );
        return reply.send({ ok: true, target_tenant: target, api_key: generated.secret, raw_key: generated.value, shown_once: true });
      } catch (error) {
        const mapped = mapConnectionError(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.post(
    "/owner-admin/connections/tenants/:tenantCode/:code/secrets/:kind/rotate",
    {
      schema: {
        params: tenantParamsSchema(true, true),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["value"],
          properties: { value: { type: "string", minLength: 1, maxLength: 16384 } },
        },
      },
    },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, SECURITY_WRITE_PERMISSIONS, { csrf: true });
      if (!session) return;
      const assurance = requireFreshSecretAssurance(session, app.config);
      if (!assurance.ok) return reply.code(assurance.status).send({ ok: false, error: assurance.error });
      try {
        const target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        const status = await deps.withTenantTransaction(app.db, target.id, (client) =>
          deps.rotateSecret({
            client,
            tenantId: target.id,
            connectionCode: req.params.code,
            secretKind: req.params.kind,
            plaintext: req.body.value,
            actorIdentityId: session.identity_id,
            config: app.config,
          })
        );
        return reply.send({ ok: true, target_tenant: target, secret: status });
      } catch (error) {
        const mapped = mapConnectionError(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.post(
    "/owner-admin/connections/tenants/:tenantCode/:code/secrets/:kind/revoke",
    { schema: { params: tenantParamsSchema(true, true) } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, SECURITY_WRITE_PERMISSIONS, { csrf: true });
      if (!session) return;
      const assurance = requireFreshSecretAssurance(session, app.config);
      if (!assurance.ok) return reply.code(assurance.status).send({ ok: false, error: assurance.error });
      try {
        const target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        const status = await deps.withTenantTransaction(app.db, target.id, (client) =>
          deps.revokeSecret({
            client,
            tenantId: target.id,
            connectionCode: req.params.code,
            secretKind: req.params.kind,
            actorIdentityId: session.identity_id,
          })
        );
        return reply.send({ ok: true, target_tenant: target, secret: status });
      } catch (error) {
        const mapped = mapConnectionError(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.get(
    "/owner-admin/connections/tenants/:tenantCode/:code/health",
    { schema: { params: tenantParamsSchema(true) } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, READ_PERMISSIONS);
      if (!session) return;
      try {
        const target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        const item = await deps.getConnectionProfile(app.db, target.id, req.params.code);
        if (!item || item.setting_status === "deprecated") return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const detail = deps.toConnectionDetailDto(item, {});
        return reply.send({ ok: true, target_tenant: target, health: detail.health || {} });
      } catch (error) {
        const mapped = mapConnectionError(error);
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.post(
    "/owner-admin/connections/tenants/:tenantCode/:code/test",
    { schema: { params: tenantParamsSchema(true) } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, TEST_PERMISSIONS, { csrf: true });
      if (!session) return;
      let target;
      let profile;
      try {
        target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        profile = await deps.getConnectionProfile(app.db, target.id, req.params.code);
        if (!profile || profile.setting_status === "deprecated") return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const baseUrl = text(profile.outbound?.base_url);
        if (!baseUrl) return reply.code(400).send({ ok: false, error: "CONNECTION_TEST_URL_REQUIRED" });
        const targetUrl = deps.joinBaseAndPath(baseUrl, profile.outbound?.healthcheck_path || "");
        const result = await deps.probeOutboundUrl(targetUrl, {
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
        await deps.updateConnectionHealth(app.db, target.id, req.params.code, health);
        return reply.send({ ok: true, target_tenant: target, result: { ...result, tested_at: nowIso } });
      } catch (error) {
        const mapped = mapConnectionError(error);
        const nowIso = new Date().toISOString();
        if (profile && target?.id) {
          await deps.updateConnectionHealth(app.db, target.id, req.params.code, {
            status: "unhealthy",
            last_test_at: nowIso,
            last_error_code: mapped.body.error,
          }).catch(() => undefined);
        }
        if (mapped.status >= 500) req.log.error({ event: "connection_target_test_error", code: error?.code || error?.name || "ERROR" });
        return reply.code(mapped.status).send(mapped.body);
      }
    }
  );

  app.get(
    "/owner-admin/connections/tenants/:tenantCode/:code/readiness",
    { schema: { params: tenantParamsSchema(true) } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, READ_PERMISSIONS);
      if (!session) return;
      try {
        const target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        const profile = await deps.getConnectionProfile(app.db, target.id, req.params.code);
        if (!profile || profile.setting_status === "deprecated") return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const credentialStatuses = await loadCredentialStatuses(deps, app, target.id, req.params.code);
        return reply.send({
          ok: true,
          target_tenant: target,
          readiness: {
            activation: deps.buildConnectionActivationStatus(profile, credentialStatuses),
            inbound: deps.buildInboundReadiness(profile, credentialStatuses),
            outbound: deps.buildOutboundReadiness(profile, credentialStatuses),
          },
        });
      } catch (error) {
        req.log.error({ event: "connection_target_readiness_error", code: error?.code || error?.name || "ERROR" });
        return reply.code(500).send({ ok: false, error: "CONNECTION_SERVICE_UNAVAILABLE" });
      }
    }
  );

  app.post(
    "/owner-admin/connections/tenants/:tenantCode/:code/test/inbound-readiness",
    { schema: { params: tenantParamsSchema(true) } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, TEST_PERMISSIONS, { csrf: true });
      if (!session) return;
      try {
        const target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        const profile = await deps.getConnectionProfile(app.db, target.id, req.params.code);
        if (!profile || profile.setting_status === "deprecated") return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const credentialStatuses = await loadCredentialStatuses(deps, app, target.id, req.params.code);
        return reply.send({ ok: true, target_tenant: target, result: deps.buildInboundReadiness(profile, credentialStatuses) });
      } catch (error) {
        req.log.error({ event: "connection_target_inbound_readiness_error", code: error?.code || error?.name || "ERROR" });
        return reply.code(500).send({ ok: false, error: "CONNECTION_SERVICE_UNAVAILABLE" });
      }
    }
  );

  app.get(
    "/owner-admin/connections/tenants/:tenantCode/:code/endpoints",
    { schema: { params: tenantParamsSchema(true) } },
    async (req, reply) => {
      const session = await requirePermission(app, req, reply, READ_PERMISSIONS);
      if (!session) return;
      try {
        const target = await resolveTarget(deps, app, req, reply);
        if (!target) return;
        const profile = await deps.getConnectionProfile(app.db, target.id, req.params.code);
        if (!profile || profile.setting_status === "deprecated") return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const credentialStatuses = await loadCredentialStatuses(deps, app, target.id, req.params.code);
        const readiness = deps.buildInboundReadiness(profile, credentialStatuses);
        const endpoints = buildEndpointProjection({
          origin: requestOrigin(req),
          tenantCode: target.code,
          profile,
          readiness,
        });
        return reply.send({ ok: true, target_tenant: target, endpoints });
      } catch (error) {
        req.log.error({ event: "connection_target_endpoint_error", code: error?.code || error?.name || "ERROR" });
        return reply.code(500).send({ ok: false, error: "CONNECTION_SERVICE_UNAVAILABLE" });
      }
    }
  );
}

export {
  buildDependencies,
  mapConnectionError,
  resolveTarget,
  tenantParamsSchema,
};
