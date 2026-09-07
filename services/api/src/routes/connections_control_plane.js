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
import {
  ConnectionInputPolicyError,
  assertConnectionProfileInputSafe,
} from "../services/connections/connectionInputPolicy.js";
import {
  toConnectionDetailDto,
  toConnectionSummaryDto,
} from "../services/connections/connectionDto.js";

const CONNECTION_READ = ["OWNER_ADMIN_CONSOLE_READ"];
const CONNECTION_WRITE = ["OWNER_ADMIN_CONNECTION_WRITE"];
const CONNECTION_SECRET_MANAGE = ["OWNER_ADMIN_CONNECTION_SECRET_MANAGE"];
const CONNECTION_TEST = ["OWNER_ADMIN_CONNECTION_TEST"];
const FORBIDDEN_TENANT_KEYS = new Set(["tenant", "tenant_id", "tenantid"]);

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
  if (!body || typeof body !== "object" || Array.isArray(body)) return true;
  for (const key of Object.keys(body)) {
    const compact = String(key).replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (FORBIDDEN_TENANT_KEYS.has(String(key).toLowerCase()) || compact === "tenantid") {
      throw new ConnectionProfileError(
        "Tenant scope is derived from the authenticated session and cannot be overridden.",
        "TENANT_OVERRIDE_FORBIDDEN",
        400
      );
    }
  }
  return true;
}

function mapPublicError(error) {
  if (
    error instanceof ConnectionProfileError
    || error instanceof ConnectionSecretError
    || error instanceof ConnectionInputPolicyError
    || error instanceof OutboundHttpPolicyError
  ) {
    return {
      status: error.status || 400,
      body: {
        ok: false,
        error: error.code || "CONNECTION_REQUEST_FAILED",
        message: error.message,
        ...(error.path ? { path: error.path } : {}),
        ...(Array.isArray(error.details) && error.details.length ? { details: error.details } : {}),
      },
    };
  }
  return null;
}

async function sendHandled(reply, callback) {
  try {
    return await callback();
  } catch (error) {
    const mapped = mapPublicError(error);
    if (mapped) return reply.code(mapped.status).send(mapped.body);
    throw error;
  }
}

async function loadCredentialStatuses(app, tenantId, connectionCode) {
  return withTenantTransaction(app.db, tenantId, (client) =>
    listSecretStatuses(client, tenantId, connectionCode)
  );
}

const CODE_PARAM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["code"],
  properties: {
    code: { type: "string", minLength: 3, maxLength: 64 },
  },
};

const SECRET_PARAM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["code", "kind"],
  properties: {
    code: { type: "string", minLength: 3, maxLength: 64 },
    kind: { type: "string", minLength: 2, maxLength: 64 },
  },
};

export default async function connectionControlPlaneRoutes(app) {
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
    return reply.send({ ok: true, items: items.map(toConnectionSummaryDto) });
  });

  app.post(
    "/owner-admin/connections",
    { schema: { body: { type: "object", additionalProperties: true } } },
    async (req, reply) => {
      const session = await requireAccess(app, req, reply, CONNECTION_WRITE, { csrf: true });
      if (!session) return;
      return sendHandled(reply, async () => {
        assertNoTenantOverride(req.body);
        assertConnectionProfileInputSafe(req.body);
        const taxonomy = await loadConnectionTaxonomy(app.db);
        const profile = await createConnectionProfile(app.db, session.tenant_id, req.body, taxonomy);
        return reply.code(201).send({ ok: true, item: toConnectionDetailDto(profile, {}) });
      });
    }
  );

  app.get(
    "/owner-admin/connections/:code",
    { schema: { params: CODE_PARAM_SCHEMA } },
    async (req, reply) => {
      const session = await requireAccess(app, req, reply, CONNECTION_READ);
      if (!session) return;
      return sendHandled(reply, async () => {
        const profile = await getConnectionProfile(app.db, session.tenant_id, req.params.code);
        if (!profile) return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const credentials = await loadCredentialStatuses(
          app,
          session.tenant_id,
          profile.identity?.connection_code || req.params.code
        );
        return reply.send({ ok: true, item: toConnectionDetailDto(profile, credentials) });
      });
    }
  );

  app.patch(
    "/owner-admin/connections/:code",
    {
      schema: {
        params: CODE_PARAM_SCHEMA,
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const session = await requireAccess(app, req, reply, CONNECTION_WRITE, { csrf: true });
      if (!session) return;
      return sendHandled(reply, async () => {
        assertNoTenantOverride(req.body);
        assertConnectionProfileInputSafe(req.body);
        const taxonomy = await loadConnectionTaxonomy(app.db);
        const profile = await updateConnectionProfile(
          app.db,
          session.tenant_id,
          req.params.code,
          req.body,
          taxonomy
        );
        const credentials = await loadCredentialStatuses(
          app,
          session.tenant_id,
          profile.identity?.connection_code || req.params.code
        );
        return reply.send({ ok: true, item: toConnectionDetailDto(profile, credentials) });
      });
    }
  );

  app.get(
    "/owner-admin/connections/:code/secrets",
    { schema: { params: CODE_PARAM_SCHEMA } },
    async (req, reply) => {
      const session = await requireAccess(app, req, reply, CONNECTION_READ);
      if (!session) return;
      return sendHandled(reply, async () => {
        const profile = await getConnectionProfile(app.db, session.tenant_id, req.params.code);
        if (!profile) return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const items = await loadCredentialStatuses(app, session.tenant_id, req.params.code);
        return reply.send({ ok: true, items });
      });
    }
  );

  app.post(
    "/owner-admin/connections/:code/secrets/:kind/rotate",
    {
      schema: {
        params: SECRET_PARAM_SCHEMA,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["secret"],
          properties: {
            secret: { type: "string", minLength: 1, maxLength: 16384 },
          },
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
        params: SECRET_PARAM_SCHEMA,
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
    { schema: { params: CODE_PARAM_SCHEMA } },
    async (req, reply) => {
      const session = await requireAccess(app, req, reply, CONNECTION_READ);
      if (!session) return;
      return sendHandled(reply, async () => {
        const profile = await getConnectionProfile(app.db, session.tenant_id, req.params.code);
        if (!profile) return reply.code(404).send({ ok: false, error: "CONNECTION_NOT_FOUND" });
        const dto = toConnectionDetailDto(profile, {});
        return reply.send({ ok: true, health: dto.health || { status: "unknown" } });
      });
    }
  );

  app.post(
    "/owner-admin/connections/:code/test",
    {
      schema: {
        params: CODE_PARAM_SCHEMA,
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

        const probeUrl = joinBaseAndPath(
          profile.outbound?.base_url,
          profile.outbound?.healthcheck_path || "/"
        );
        const configuredMethod = String(profile.outbound?.test_request_method || "HEAD").toUpperCase();
        const probeMethod = ["GET", "HEAD"].includes(configuredMethod) ? configuredMethod : "HEAD";
        const probe = await probeOutboundUrl(probeUrl, {
          method: probeMethod,
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
        const updated = await updateConnectionHealth(
          app.db,
          session.tenant_id,
          req.params.code,
          healthPatch
        );
        const safeHealth = toConnectionDetailDto(updated, {}).health;
        return reply.send({ ok: true, probe, health: safeHealth });
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
  mapPublicError,
};
