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
  loadConnectionTaxonomy,
  publicConnectionTaxonomy,
} from "../services/connections/connectionTaxonomy.js";
import {
  ConnectionSecretError,
  listSecretStatuses,
  revokeSecret,
  rotateSecret,
} from "../services/connections/connectionSecretStore.js";

const CONNECTION_READ = ["OWNER_ADMIN_CONSOLE_READ"];
const CONNECTION_WRITE = ["OWNER_ADMIN_CONNECTION_WRITE"];
const CONNECTION_SECRET_MANAGE = ["OWNER_ADMIN_CONNECTION_SECRET_MANAGE"];
const CONNECTION_TEST = ["OWNER_ADMIN_CONNECTION_TEST"];
const FORBIDDEN_TENANT_KEYS = new Set(["tenant", "tenant_id", "tenantid", "tenantId"]);

function text(value) {
  return String(value ?? "").trim();
}

function publicError(error) {
  if (
    error instanceof ConnectionProfileError
    || error instanceof ConnectionSecretError
    || error instanceof OutboundHttpPolicyError
  ) {
    return {
      status: error.status || 400,
      body: {
        ok: false,
        error: error.code || "CONNECTION_REQUEST_FAILED",
        message: error.message,
        ...(Array.isArray(error.details) && error.details.length ? { details: error.details } : {}),
      },
    };
  }
  return null;
}

async function requireAccess(app, req, reply, permissions, options = {}) {
  const permission = await app.requirePermission(req, permissions, { realm: "EIP" });
  if (!permission.ok) {
    reply.code(permission.status).send({ ok: false, error: permission.error });
    return null;
  }
  if (options.csrf === true) {
    const csrf = await app.requireCsrf(req);
    if (!csrf.ok) {
      reply.code(csrf.status).send({ ok: false, error: csrf.error });
      return null;
    }
  }
  return permission.session;
}

function assertNoTenantOverride(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_TENANT_KEYS.has(key) || key.toLowerCase() === "tenant_id") {
      throw new ConnectionProfileError(
        "Tenant scope is derived from the authenticated session and cannot be overridden.",
        "TENANT_OVERRIDE_FORBIDDEN",
        400
      );
    }
  }
}

function detailDto(profile, credentialStatus = {}) {
  if (!profile) return null;
  return {
    id: profile.id,
    profile_version: profile.profile_version || 1,
    identity: profile.identity || {},
    inbound: profile.inbound || {},
    verification: profile.verification || {},
    idempotency: profile.idempotency || {},
    outbound: profile.outbound || {},
    routing: profile.routing || {},
    audit: profile.audit || {},
    attrs: profile.attrs || {},
    health: profile.health || {},
    credential_status: credentialStatus,
    setting_status: profile.setting_status || "active",
    created_at: profile.created_at || null,
    updated_at: profile.updated_at || null,
  };
}

async function credentialStatuses(app, tenantId, connectionCode) {
  return withTenantTransaction(app.db, tenantId, (client) =>
    listSecretStatuses(client, tenantId, connectionCode)
  );
}

async function sendHandled(reply, callback) {
  try {
    return await callback();
  } catch (error) {
    const mapped = publicError(error);
    if (mapped) return reply.code(mapped.status).send(mapped.body);
    throw error;
  }
}

export default async function connectionRoutes(app) {
  app.get("/owner-admin/connections/taxonomy", async (req, reply) => {
    const session = await requireAccess(app, req, reply, CONNECTION_READ);
    if (!session) return;
    const taxonomy = await loadConnectionTaxonomy(app.db);
    return reply.send({ ok: true, taxonomy: publicConnectionTaxonomy(taxonomy) });
  });

  app.get("/owner-admin/connections", async (req, reply) => {
    const session = await requireAccess(app, req, reply, CONNECTION_READ);
    if (!session) return;
    const items = await listConnectionProfiles(app.db, session.tenant_id);
    return reply.send({ ok: true, items });
  });

  app.post(
    "/owner-admin/connections",
    {
      schema: {
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const session = await requireAccess(app, req, reply, CONNECTION_WRITE, { csrf: true });
      if (!session) return;
      return sendHandled(reply, async () => {
        assertNoTenantOverride(req.body);
        const taxonomy = await loadConnectionTaxonomy(app.db);
        const profile = await createConnectionProfile(app.db, session.tenant_id, req.body, taxonomy);
        return reply.code(201).send({ ok: true, item: detailDto(profile, {}) });
      });
    }
  );

  app.get(
    "/owner-admin/connections/:code",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: { code: { type: "string", minLength: 3, maxLength: 64 } },
        },
      },
    },
    async (req, reply) => {
      const session = await requireAccess(app, req, reply, CONNECTION_READ);
      if (!session) return;
      return sendHandled(reply, async () => {
        const profile = await getConnectionProfile(app.db, session.tenant_id, req.params.code);
        if (!profile) return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const credentials = await credentialStatuses(app, session.tenant_id, profile.identity.connection_code);
        return reply.send({ ok: true, item: detailDto(profile, credentials) });
      });
    }
  );

  app.patch(
    "/owner-admin/connections/:code",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: { code: { type: "string", minLength: 3, maxLength: 64 } },
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const session = await requireAccess(app, req, reply, CONNECTION_WRITE, { csrf: true });
      if (!session) return;
      return sendHandled(reply, async () => {
        assertNoTenantOverride(req.body);
        const taxonomy = await loadConnectionTaxonomy(app.db);
        const profile = await updateConnectionProfile(
          app.db,
          session.tenant_id,
          req.params.code,
          req.body,
          taxonomy
        );
        const credentials = await credentialStatuses(app, session.tenant_id, profile.identity.connection_code);
        return reply.send({ ok: true, item: detailDto(profile, credentials) });
      });
    }
  );

  app.get(
    "/owner-admin/connections/:code/secrets",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: { code: { type: "string", minLength: 3, maxLength: 64 } },
        },
      },
    },
    async (req, reply) => {
      const session = await requireAccess(app, req, reply, CONNECTION_READ);
      if (!session) return;
      return sendHandled(reply, async () => {
        const profile = await getConnectionProfile(app.db, session.tenant_id, req.params.code);
        if (!profile) return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const items = await credentialStatuses(app, session.tenant_id, profile.identity.connection_code);
        return reply.send({ ok: true, items });
      });
    }
  );

  app.post(
    "/owner-admin/connections/:code/secrets/:kind/rotate",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["code", "kind"],
          properties: {
            code: { type: "string", minLength: 3, maxLength: 64 },
            kind: { type: "string", minLength: 2, maxLength: 64 },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["secret"],
          properties: { secret: { type: "string", minLength: 1, maxLength: 16384 } },
        },
      },
    },
    async (req, reply) => {
      const session = await requireAccess(app, req, reply, CONNECTION_SECRET_MANAGE, { csrf: true });
      if (!session) return;
      return sendHandled(reply, async () => {
        const item = await withTenantTransaction(app.db, session.tenant_id, (client) =>
          rotateSecret({
            client,
            tenantId: session.tenant_id,
            connectionCode: req.params.code,
            secretKind: req.params.kind,
            plaintext: req.body.secret,
            actorIdentityId: session.identity_id,
            config: app.config,
          })
        );
        return reply.send({ ok: true, item });
      });
    }
  );

  app.post(
    "/owner-admin/connections/:code/secrets/:kind/revoke",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["code", "kind"],
          properties: {
            code: { type: "string", minLength: 3, maxLength: 64 },
            kind: { type: "string", minLength: 2, maxLength: 64 },
          },
        },
        body: { type: "object", additionalProperties: false, default: {} },
      },
    },
    async (req, reply) => {
      const session = await requireAccess(app, req, reply, CONNECTION_SECRET_MANAGE, { csrf: true });
      if (!session) return;
      return sendHandled(reply, async () => {
        const item = await withTenantTransaction(app.db, session.tenant_id, (client) =>
          revokeSecret({
            client,
            tenantId: session.tenant_id,
            connectionCode: req.params.code,
            secretKind: req.params.kind,
            actorIdentityId: session.identity_id,
          })
        );
        return reply.send({ ok: true, item });
      });
    }
  );

  app.get(
    "/owner-admin/connections/:code/health",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: { code: { type: "string", minLength: 3, maxLength: 64 } },
        },
      },
    },
    async (req, reply) => {
      const session = await requireAccess(app, req, reply, CONNECTION_READ);
      if (!session) return;
      return sendHandled(reply, async () => {
        const profile = await getConnectionProfile(app.db, session.tenant_id, req.params.code);
        if (!profile) return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        return reply.send({ ok: true, health: profile.health || { status: "unknown" } });
      });
    }
  );

  app.post(
    "/owner-admin/connections/:code/test",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: { code: { type: "string", minLength: 3, maxLength: 64 } },
        },
        body: { type: "object", additionalProperties: false, default: {} },
      },
    },
    async (req, reply) => {
      const session = await requireAccess(app, req, reply, CONNECTION_TEST, { csrf: true });
      if (!session) return;
      return sendHandled(reply, async () => {
        const profile = await getConnectionProfile(app.db, session.tenant_id, req.params.code);
        if (!profile) return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        if (!["outbound", "both"].includes(profile.identity?.direction)) {
          throw new ConnectionProfileError(
            "Only outbound-capable connections can run an outbound health probe.",
            "CONNECTION_TEST_DIRECTION_UNSUPPORTED",
            400
          );
        }
        const probeUrl = joinBaseAndPath(profile.outbound?.base_url, profile.outbound?.healthcheck_path || "/");
        const probe = await probeOutboundUrl(probeUrl, {
          method: profile.outbound?.test_request_method || "HEAD",
          timeoutMs: profile.outbound?.timeout_ms || 8000,
        });
        const checkedAt = new Date().toISOString();
        const healthPatch = {
          status: probe.ok ? "healthy" : "unhealthy",
          checked_at: checkedAt,
          status_code: probe.status_code,
          latency_ms: probe.latency_ms,
          ...(probe.ok ? { last_successful_test_at: checkedAt } : {}),
        };
        const updated = await updateConnectionHealth(app.db, session.tenant_id, req.params.code, healthPatch);
        return reply.send({ ok: true, probe, health: updated.health || healthPatch });
      });
    }
  );
}

export {
  CONNECTION_READ,
  CONNECTION_SECRET_MANAGE,
  CONNECTION_TEST,
  CONNECTION_WRITE,
  assertNoTenantOverride,
  detailDto,
  publicError,
};
