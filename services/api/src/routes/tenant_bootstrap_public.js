import crypto from "node:crypto";
import { evaluatePasswordStrength, hashPassword } from "../auth/password.js";
import { hashBootstrapToken, OWNER_ADMIN_PERMISSION_CODES } from "./owner_admin_control.js";

const BOOTSTRAP_RATE_LIMIT = { max: 12, timeWindow: "10 minute" };
const BODY_LIMIT = 16 * 1024;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function buildPublicRouteConfig(app) {
  const config = { rateLimit: BOOTSTRAP_RATE_LIMIT };
  if (app.config?.corsOrigin !== undefined) {
    config.cors = { origin: app.config.corsOrigin, credentials: false };
  }
  return config;
}

async function writeCompletionAudit(app, { tenantId, identityId, requestId }) {
  await app.db.query(
    `
    INSERT INTO security.audit_event
      (tenant_id, actor_identity_id, event_code, category, severity, outcome,
       subject_kind, subject_id, summary, attrs)
    VALUES
      ($1::uuid, $2::uuid, 'tenant.onboarding.completed', 'onboarding', 'info', 'success',
       'tenant_request', $3, 'Completed tenant bootstrap', $4::jsonb)
    `,
    [
      tenantId,
      identityId,
      requestId,
      JSON.stringify({ permission_count: OWNER_ADMIN_PERMISSION_CODES.length }),
    ]
  );
}

export default async function tenantBootstrapPublicRoutes(app) {
  app.post(
    "/tenant-bootstrap/complete",
    {
      config: buildPublicRouteConfig(app),
      bodyLimit: BODY_LIMIT,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token", "password"],
          properties: {
            token: { type: "string", minLength: 32, maxLength: 200 },
            password: { type: "string", minLength: 12, maxLength: 128 },
          },
        },
      },
    },
    async (request, reply) => {
      const token = normalizeText(request.body?.token);
      const password = String(request.body?.password || "");
      const strength = evaluatePasswordStrength(password);
      if (!strength.ok) {
        return reply.code(400).send({ ok: false, error: "PASSWORD_POLICY", feedback: strength.feedback });
      }

      let tokenHash;
      try {
        tokenHash = hashBootstrapToken(app, token);
      } catch (error) {
        request.log.error({ event: "tenant_bootstrap_config_error", message: error?.message || String(error) });
        return reply.code(503).send({ ok: false, error: "BOOTSTRAP_UNAVAILABLE" });
      }

      const passwordHash = await hashPassword(password);
      const credentialId = crypto.randomUUID();
      const client = await app.db.connect();
      let requestRow;
      try {
        await client.query("BEGIN");
        const selected = await client.query(
          `
          SELECT request.*, tenant.tenant_code, tenant.tenant_name
          FROM kernel.tenant_request AS request
          JOIN kernel.tenants AS tenant
            ON tenant.tenant_id = request.tenant_id
          WHERE request.bootstrap_token_hash = $1
          FOR UPDATE OF request
          `,
          [tokenHash]
        );
        if (selected.rowCount !== 1) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ ok: false, error: "BOOTSTRAP_TOKEN_INVALID" });
        }
        requestRow = selected.rows[0];
        if (requestRow.status_code !== "BOOTSTRAP_PENDING") {
          await client.query("ROLLBACK");
          return reply.code(409).send({ ok: false, error: "BOOTSTRAP_NOT_PENDING" });
        }
        const expiresAt = new Date(requestRow.bootstrap_expires_at);
        if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
          // Keep the governed request in BOOTSTRAP_PENDING so the administrator can
          // safely rotate the one-time token through the existing resend action.
          // Marking the request EXPIRED here used to force it back through approval,
          // which could create a second tenant for the same already-approved request.
          await client.query("ROLLBACK");
          return reply.code(410).send({ ok: false, error: "BOOTSTRAP_TOKEN_EXPIRED" });
        }
        if (!requestRow.tenant_id || !requestRow.admin_identity_id) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ ok: false, error: "BOOTSTRAP_STATE_INVALID" });
        }

        await client.query(
          `
          INSERT INTO eip_auth.auth_credential
            (id, tenant_id, identity_id, credential_type, secret_hash, algorithm, meta)
          VALUES
            ($1::uuid, $2::uuid, $3::uuid, 'password', $4, 'argon2id', $5::jsonb)
          ON CONFLICT DO NOTHING
          `,
          [
            credentialId,
            requestRow.tenant_id,
            requestRow.admin_identity_id,
            passwordHash,
            JSON.stringify({ created_by: "tenant_bootstrap" }),
          ]
        );

        await client.query(
          `
          UPDATE eip_auth.auth_identity
          SET is_active = true,
              is_locked = false,
              attrs = jsonb_set(
                COALESCE(attrs, '{}'::jsonb),
                '{permissions}',
                to_jsonb($3::text[]),
                true
              ),
              updated_at = now()
          WHERE tenant_id = $1::uuid
            AND id = $2::uuid
          `,
          [requestRow.tenant_id, requestRow.admin_identity_id, OWNER_ADMIN_PERMISSION_CODES]
        );

        await client.query(
          `
          UPDATE kernel.tenants
          SET tenant_status = 'active',
              updated_at = now()
          WHERE tenant_id = $1::uuid
          `,
          [requestRow.tenant_id]
        );

        await client.query(
          `
          UPDATE kernel.tenant_request
          SET status_code = 'ACTIVE',
              bootstrap_token_hash = NULL,
              bootstrap_used_at = now(),
              updated_at = now()
          WHERE id = $1::uuid
          `,
          [requestRow.id]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        request.log.error({ event: "tenant_bootstrap_complete_error", message: error?.message || String(error) });
        return reply.code(500).send({ ok: false, error: "BOOTSTRAP_FAILED" });
      } finally {
        client.release();
      }

      await writeCompletionAudit(app, {
        tenantId: requestRow.tenant_id,
        identityId: requestRow.admin_identity_id,
        requestId: requestRow.id,
      }).catch((error) => {
        request.log.error({ event: "tenant_bootstrap_audit_failed", message: error?.message || String(error) });
      });

      return reply.send({
        ok: true,
        tenant_code: requestRow.tenant_code,
        tenant_name: requestRow.tenant_name,
        login: requestRow.email,
      });
    }
  );
}
