import crypto from "node:crypto";
import { withTenantTransaction } from "../../db/tenantTransaction.js";
import { ConnectionInboundRuntimeError } from "./connectionInboundRuntime.js";

const RECEIPT_RECORD_TYPE = "connection_inbound_receipt";
const EVENT_ID_MAX_LENGTH = 256;
const EVENT_KEY_MAX_LENGTH = 160;
const BODY_PATH_MAX_SEGMENTS = 16;
const EVENT_ID_LOCATIONS = new Set(["header", "query", "body"]);
const IDEMPOTENCY_SCOPES = new Set(["connection", "tenant"]);
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function text(value) {
  return String(value ?? "").trim();
}

function sha256Hex(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8");
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeEventLocation(value) {
  const raw = text(value).toLowerCase();
  const aliases = {
    headers: "header",
    querystring: "query",
    payload: "body",
  };
  const normalized = aliases[raw] || raw;
  if (!EVENT_ID_LOCATIONS.has(normalized)) {
    throw new ConnectionInboundRuntimeError(
      "Configured idempotency event location is unsupported.",
      "IDEMPOTENCY_EVENT_LOCATION_UNSUPPORTED",
      503
    );
  }
  return normalized;
}

function normalizeIdempotencyScope(value) {
  const normalized = text(value).toLowerCase();
  if (!IDEMPOTENCY_SCOPES.has(normalized)) {
    throw new ConnectionInboundRuntimeError(
      "Configured idempotency scope is unsupported.",
      "IDEMPOTENCY_SCOPE_UNSUPPORTED",
      503
    );
  }
  return normalized;
}

function boundedEventKey(value) {
  const key = text(value);
  if (!key || key.length > EVENT_KEY_MAX_LENGTH) {
    throw new ConnectionInboundRuntimeError(
      "Configured idempotency event key is missing or too long.",
      "IDEMPOTENCY_EVENT_KEY_INVALID",
      503
    );
  }
  return key;
}

function normalizeEventId(value) {
  if (value === null || value === undefined || typeof value === "object") {
    throw new ConnectionInboundRuntimeError(
      "Inbound event ID is required.",
      "IDEMPOTENCY_EVENT_ID_REQUIRED",
      400
    );
  }
  const eventId = text(value);
  if (!eventId) {
    throw new ConnectionInboundRuntimeError(
      "Inbound event ID is required.",
      "IDEMPOTENCY_EVENT_ID_REQUIRED",
      400
    );
  }
  if (eventId.length > EVENT_ID_MAX_LENGTH) {
    throw new ConnectionInboundRuntimeError(
      "Inbound event ID exceeds the bounded length.",
      "IDEMPOTENCY_EVENT_ID_TOO_LONG",
      400
    );
  }
  return eventId;
}

function readHeader(headers, name) {
  const target = text(name).toLowerCase();
  if (!target) return undefined;
  for (const [rawKey, rawValue] of Object.entries(headers || {})) {
    if (text(rawKey).toLowerCase() !== target) continue;
    return Array.isArray(rawValue) ? rawValue[0] : rawValue;
  }
  return undefined;
}

function readQuery(query, name) {
  const target = text(name);
  if (!target) return undefined;
  const value = query && typeof query === "object" ? query[target] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function parseJsonBody(rawBody) {
  const buffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
  if (buffer.length === 0) return null;
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new ConnectionInboundRuntimeError(
      "Configured body idempotency requires a valid JSON payload.",
      "IDEMPOTENCY_BODY_JSON_INVALID",
      400
    );
  }
}

function readBodyPath(rawBody, path) {
  const key = boundedEventKey(path);
  const segments = key.split(".").filter(Boolean);
  if (segments.length === 0 || segments.length > BODY_PATH_MAX_SEGMENTS) {
    throw new ConnectionInboundRuntimeError(
      "Configured idempotency body path is invalid.",
      "IDEMPOTENCY_BODY_PATH_INVALID",
      503
    );
  }
  let value = parseJsonBody(rawBody);
  for (const segment of segments) {
    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) {
      throw new ConnectionInboundRuntimeError(
        "Configured idempotency body path is forbidden.",
        "IDEMPOTENCY_BODY_PATH_INVALID",
        503
      );
    }
    if (value === null || value === undefined || typeof value !== "object") return undefined;
    value = value[segment];
  }
  return value;
}

function extractInboundEventId(profile, request = {}) {
  const idempotency = profile?.idempotency || {};
  const location = normalizeEventLocation(idempotency.event_id_location);
  const key = boundedEventKey(idempotency.event_id_key);

  let value;
  if (location === "header") value = readHeader(request.headers, key);
  if (location === "query") value = readQuery(request.query, key);
  if (location === "body") value = readBodyPath(request.rawBody, key);

  return {
    event_id: normalizeEventId(value),
    location,
    key,
  };
}

function buildIdempotencyKeyDigest({ tenantId, connectionCode, scope, eventId }) {
  const safeTenantId = text(tenantId);
  const safeConnectionCode = text(connectionCode).toLowerCase();
  const safeScope = normalizeIdempotencyScope(scope);
  const safeEventId = normalizeEventId(eventId);
  if (!safeTenantId) {
    throw new ConnectionInboundRuntimeError(
      "Tenant context is required for inbound idempotency.",
      "TENANT_CONTEXT_REQUIRED",
      500
    );
  }
  if (safeScope === "connection" && !safeConnectionCode) {
    throw new ConnectionInboundRuntimeError(
      "Connection code is required for connection-scoped idempotency.",
      "CONNECTION_CONTEXT_REQUIRED",
      500
    );
  }

  const authority = safeScope === "tenant"
    ? `tenant:${safeTenantId}`
    : `tenant:${safeTenantId}:connection:${safeConnectionCode}`;
  return sha256Hex(`${authority}\nevent:${safeEventId}`);
}

function safeVerificationProjection(verification = {}) {
  return {
    mode: text(verification.mode).toLowerCase() || null,
    verified: verification.verified === true,
    assurance: text(verification.assurance) || null,
  };
}

async function claimInboundReceipt({
  pool,
  tenantId,
  profile,
  request = {},
  verification = {},
  channel,
  correlationId,
  acceptedAt = new Date().toISOString(),
  transaction = withTenantTransaction,
}) {
  const connectionCode = text(profile?.identity?.connection_code).toLowerCase();
  const scope = normalizeIdempotencyScope(profile?.idempotency?.idempotency_scope);
  const event = extractInboundEventId(profile, request);
  const rawBody = Buffer.isBuffer(request.rawBody)
    ? request.rawBody
    : Buffer.from(request.rawBody || "");
  const payloadDigest = sha256Hex(rawBody);
  const keyDigest = buildIdempotencyKeyDigest({
    tenantId,
    connectionCode,
    scope,
    eventId: event.event_id,
  });
  const payloadBytes = rawBody.length;
  const verificationProjection = safeVerificationProjection(verification);

  return transaction(pool, tenantId, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [keyDigest]
    );

    const existing = await client.query(
      `
      SELECT id, payload, attrs, created_at
      FROM eip_core.info_record
      WHERE tenant_id = $1::uuid
        AND record_type = $2
        AND attrs->>'idempotency_key_digest' = $3
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [tenantId, RECEIPT_RECORD_TYPE, keyDigest]
    );

    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      const existingPayloadDigest = text(row?.payload?.payload_digest);
      if (existingPayloadDigest && existingPayloadDigest !== payloadDigest) {
        throw new ConnectionInboundRuntimeError(
          "The inbound event ID was already used with a different payload.",
          "IDEMPOTENCY_CONFLICT",
          409
        );
      }
      return {
        duplicate: true,
        receipt_id: row.id,
        idempotency_scope: scope,
        payload_digest: payloadDigest,
        accepted_at: row.created_at || null,
      };
    }

    const payload = {
      correlation_id: text(correlationId) || null,
      connection_code: connectionCode || null,
      channel: text(channel).toLowerCase() || null,
      verification: verificationProjection,
      payload_digest: payloadDigest,
      payload_bytes: payloadBytes,
      accepted_at: acceptedAt,
    };
    const attrs = {
      transport_evidence: true,
      idempotency_key_digest: keyDigest,
      idempotency_scope: scope,
      event_id_location: event.location,
      configured_audit_record_type: text(profile?.audit?.audit_record_type) || null,
    };

    const inserted = await client.query(
      `
      INSERT INTO eip_core.info_record
        (tenant_id, record_type, title, description, payload, attrs, created_by_agent_id)
      VALUES
        ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, NULL)
      RETURNING id, created_at
      `,
      [
        tenantId,
        RECEIPT_RECORD_TYPE,
        "Inbound connection receipt",
        "Verified external transport receipt. Raw request body and credentials are not stored.",
        JSON.stringify(payload),
        JSON.stringify(attrs),
      ]
    );

    return {
      duplicate: false,
      receipt_id: inserted.rows[0]?.id || null,
      idempotency_scope: scope,
      payload_digest: payloadDigest,
      accepted_at: inserted.rows[0]?.created_at || acceptedAt,
    };
  });
}

export {
  BODY_PATH_MAX_SEGMENTS,
  EVENT_ID_LOCATIONS,
  EVENT_ID_MAX_LENGTH,
  IDEMPOTENCY_SCOPES,
  RECEIPT_RECORD_TYPE,
  buildIdempotencyKeyDigest,
  claimInboundReceipt,
  extractInboundEventId,
  normalizeEventLocation,
  normalizeIdempotencyScope,
  sha256Hex,
};
