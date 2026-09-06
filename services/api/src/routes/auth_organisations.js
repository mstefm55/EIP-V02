// Railway redeploy marker: organisation parity repair validated.
import { verifyPassword } from "../auth/password.js";

const ORG_LOOKUP_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

function normalizeString(value) {
  return String(value ?? "").trim();
}

function parseAllowedOrigins(app) {
  const raw = app.config?.corsOrigin;
  if (!raw) return [];
  if (raw === true || raw === "*") return ["*"];
  if (Array.isArray(raw)) return raw.map((entry) => String(entry).trim()).filter(Boolean);
  return String(raw)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getRequestOrigin(request) {
  const origin = request.headers?.origin;
  if (origin) return String(origin).trim();

  const referer = request.headers?.referer;
  if (!referer) return "";
  try {
    return new URL(String(referer)).origin;
  } catch {
    return "";
  }
}

function isTrustedOrigin(request, allowedOrigins) {
  const requestOrigin = getRequestOrigin(request);
  if (!requestOrigin) return true;
  if (allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(requestOrigin);
}

function organisationLookupSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      email: { type: "string", minLength: 1, maxLength: 320 },
      login: { type: "string", minLength: 1, maxLength: 320 },
      password: { type: "string", maxLength: 512 },
    },
    anyOf: [{ required: ["email"] }, { required: ["login"] }],
  };
}

async function loadOrganisationCandidates(app, loginValue) {
  const result = await app.db.query(
    `
    SELECT DISTINCT ON (ai.tenant_id)
      ai.tenant_id,
      ai.id AS identity_id,
      ai.login AS identity_login,
      kt.tenant_code,
      kt.tenant_name
    FROM eip_auth.auth_identity AS ai
    JOIN kernel.tenants AS kt
      ON kt.tenant_id = ai.tenant_id
    WHERE kt.tenant_status = 'active'
      AND ai.is_active = true
      AND ai.is_locked = false
      AND (
        lower(ai.login) = lower($1)
        OR lower(COALESCE(ai.attrs->>'email', '')) = lower($1)
        OR lower(COALESCE(ai.attrs->>'recovery_email', '')) = lower($1)
      )
    ORDER BY
      ai.tenant_id,
      CASE WHEN lower(ai.login) = lower($1) THEN 0 ELSE 1 END,
      ai.updated_at DESC NULLS LAST
    LIMIT 20
    `,
    [loginValue]
  );

  return result.rows || [];
}

async function filterCandidatesByPassword(app, candidates, password) {
  if (!password) return candidates;

  const verified = [];
  for (const candidate of candidates) {
    const credential = await app.loadPasswordCredential(candidate.tenant_id, candidate.identity_id);
    if (credential && await verifyPassword(password, credential)) {
      verified.push(candidate);
    }
  }
  return verified;
}

function serializeOrganisations(candidates) {
  return candidates
    .map((candidate) => ({
      id: candidate.tenant_id,
      code: candidate.tenant_code,
      name: candidate.tenant_name,
      identity_login: candidate.identity_login,
    }))
    .sort((left, right) => {
      const leftLabel = String(left.name || left.code || "").toLowerCase();
      const rightLabel = String(right.name || right.code || "").toLowerCase();
      return leftLabel.localeCompare(rightLabel);
    });
}

export default async function authOrganisationRoutes(app) {
  const allowedOrigins = parseAllowedOrigins(app);

  app.post(
    "/auth/organisations",
    {
      config: { rateLimit: ORG_LOOKUP_RATE_LIMIT },
      schema: { body: organisationLookupSchema() },
    },
    async (request, reply) => {
      try {
        if (!isTrustedOrigin(request, allowedOrigins)) {
          return reply.code(403).send({ ok: false, error: "ORIGIN_FORBIDDEN" });
        }

        const body = request.body || {};
        const loginValue = normalizeString(body.email ?? body.login).toLowerCase();
        const password = normalizeString(body.password);
        if (!loginValue) {
          return reply.code(400).send({ ok: false, error: "BAD_REQUEST" });
        }

        const candidates = await loadOrganisationCandidates(app, loginValue);
        const authorisedCandidates = await filterCandidatesByPassword(app, candidates, password);

        return reply.send({
          ok: true,
          organisations: serializeOrganisations(authorisedCandidates),
        });
      } catch (error) {
        request.log.error({
          event: "auth_organisation_lookup_error",
          message: error?.message || String(error),
        });
        return reply.code(500).send({ ok: false, error: "AUTH_UNAVAILABLE" });
      }
    }
  );
}

export {
  filterCandidatesByPassword,
  loadOrganisationCandidates,
  serializeOrganisations,
};
