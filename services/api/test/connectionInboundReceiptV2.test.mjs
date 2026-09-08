import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIdempotencyKeyDigest,
  claimInboundReceipt,
  extractInboundEventId,
} from "../src/services/connections/connectionInboundReceipt.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

function profile({ location = "header", key = "x-event-id", scope = "connection", code = "orders_api" } = {}) {
  return {
    identity: { connection_code: code },
    idempotency: {
      event_id_location: location,
      event_id_key: key,
      idempotency_scope: scope,
    },
    audit: { audit_record_type: "connection_transport" },
  };
}

test("extractInboundEventId supports governed header, query and JSON body locations", () => {
  assert.equal(
    extractInboundEventId(profile(), { headers: { "x-event-id": "evt-header" } }).event_id,
    "evt-header"
  );

  assert.equal(
    extractInboundEventId(
      profile({ location: "query", key: "event_id" }),
      { query: { event_id: "evt-query" } }
    ).event_id,
    "evt-query"
  );

  assert.equal(
    extractInboundEventId(
      profile({ location: "body", key: "meta.event.id" }),
      { rawBody: Buffer.from(JSON.stringify({ meta: { event: { id: "evt-body" } } })) }
    ).event_id,
    "evt-body"
  );
});

test("extractInboundEventId fails closed for missing, invalid and oversized identifiers", () => {
  assert.throws(
    () => extractInboundEventId(profile(), { headers: {} }),
    (error) => error?.code === "IDEMPOTENCY_EVENT_ID_REQUIRED"
  );
  assert.throws(
    () => extractInboundEventId(profile({ location: "cookie" }), { headers: {} }),
    (error) => error?.code === "IDEMPOTENCY_EVENT_LOCATION_UNSUPPORTED"
  );
  assert.throws(
    () => extractInboundEventId(profile(), { headers: { "x-event-id": "x".repeat(257) } }),
    (error) => error?.code === "IDEMPOTENCY_EVENT_ID_TOO_LONG"
  );
  assert.throws(
    () => extractInboundEventId(
      profile({ location: "body", key: "__proto__.polluted" }),
      { rawBody: Buffer.from('{"ok":true}') }
    ),
    (error) => error?.code === "IDEMPOTENCY_BODY_PATH_INVALID"
  );
});

test("idempotency digest preserves tenant and governed scope boundaries", () => {
  const connectionA = buildIdempotencyKeyDigest({
    tenantId: TENANT_A,
    connectionCode: "orders_a",
    scope: "connection",
    eventId: "evt-1",
  });
  const connectionB = buildIdempotencyKeyDigest({
    tenantId: TENANT_A,
    connectionCode: "orders_b",
    scope: "connection",
    eventId: "evt-1",
  });
  const otherTenant = buildIdempotencyKeyDigest({
    tenantId: TENANT_B,
    connectionCode: "orders_a",
    scope: "connection",
    eventId: "evt-1",
  });
  const tenantScopeA = buildIdempotencyKeyDigest({
    tenantId: TENANT_A,
    connectionCode: "orders_a",
    scope: "tenant",
    eventId: "evt-1",
  });
  const tenantScopeB = buildIdempotencyKeyDigest({
    tenantId: TENANT_A,
    connectionCode: "orders_b",
    scope: "tenant",
    eventId: "evt-1",
  });

  assert.notEqual(connectionA, connectionB);
  assert.notEqual(connectionA, otherTenant);
  assert.equal(tenantScopeA, tenantScopeB);
});

function mockTransactionClient({ existing = null } = {}) {
  const writes = [];
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("pg_advisory_xact_lock")) return { rowCount: 1, rows: [{}] };
      if (text.includes("SELECT id, payload, attrs, created_at")) {
        return existing
          ? { rowCount: 1, rows: [existing] }
          : { rowCount: 0, rows: [] };
      }
      if (text.includes("INSERT INTO eip_core.info_record")) {
        writes.push(params);
        return {
          rowCount: 1,
          rows: [{ id: "33333333-3333-4333-8333-333333333333", created_at: "2026-09-08T20:00:00.000Z" }],
        };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  return { client, calls, writes };
}

function transactionFor(client) {
  return async (_pool, tenantId, callback) => {
    assert.equal(tenantId, TENANT_A);
    return callback(client);
  };
}

test("claimInboundReceipt writes bounded kernel evidence without raw payload or credentials", async () => {
  const rawBody = Buffer.from(JSON.stringify({ event_id: "evt-1", secret: "must-not-be-stored" }));
  const { client, writes } = mockTransactionClient();

  const result = await claimInboundReceipt({
    pool: {},
    tenantId: TENANT_A,
    profile: profile({ location: "body", key: "event_id" }),
    request: {
      headers: { authorization: "Bearer do-not-store", "x-api-key": "do-not-store" },
      rawBody,
    },
    verification: { mode: "api_key", verified: true, assurance: "shared_secret" },
    channel: "public",
    correlationId: "44444444-4444-4444-8444-444444444444",
    transaction: transactionFor(client),
  });

  assert.equal(result.duplicate, false);
  assert.equal(writes.length, 1);
  const insertParams = writes[0];
  assert.equal(insertParams[0], TENANT_A);
  assert.equal(insertParams[1], "connection_inbound_receipt");

  const payload = JSON.parse(insertParams[4]);
  const attrs = JSON.parse(insertParams[5]);
  const serialized = JSON.stringify({ payload, attrs });
  assert.equal(payload.connection_code, "orders_api");
  assert.equal(payload.verification.mode, "api_key");
  assert.equal(payload.payload_bytes, rawBody.length);
  assert.match(payload.payload_digest, /^[a-f0-9]{64}$/);
  assert.match(attrs.idempotency_key_digest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(serialized, /must-not-be-stored|Bearer do-not-store|do-not-store/);
  assert.doesNotMatch(serialized, /evt-1/);
});

test("claimInboundReceipt suppresses identical duplicates", async () => {
  const body = Buffer.from('{"event_id":"evt-1","value":5}');
  const digest = await import("../src/services/connections/connectionInboundReceipt.js")
    .then((module) => module.sha256Hex(body));
  const { client, writes } = mockTransactionClient({
    existing: {
      id: "55555555-5555-4555-8555-555555555555",
      payload: { payload_digest: digest },
      attrs: {},
      created_at: "2026-09-08T19:00:00.000Z",
    },
  });

  const result = await claimInboundReceipt({
    pool: {},
    tenantId: TENANT_A,
    profile: profile({ location: "body", key: "event_id" }),
    request: { rawBody: body },
    verification: { mode: "hmac_signature", verified: true, assurance: "signed_payload" },
    channel: "public",
    correlationId: "66666666-6666-4666-8666-666666666666",
    transaction: transactionFor(client),
  });

  assert.equal(result.duplicate, true);
  assert.equal(result.receipt_id, "55555555-5555-4555-8555-555555555555");
  assert.equal(writes.length, 0);
});

test("claimInboundReceipt rejects reused event IDs with different payloads", async () => {
  const { client, writes } = mockTransactionClient({
    existing: {
      id: "77777777-7777-4777-8777-777777777777",
      payload: { payload_digest: "0".repeat(64) },
      attrs: {},
      created_at: "2026-09-08T19:00:00.000Z",
    },
  });

  await assert.rejects(
    () => claimInboundReceipt({
      pool: {},
      tenantId: TENANT_A,
      profile: profile({ location: "body", key: "event_id" }),
      request: { rawBody: Buffer.from('{"event_id":"evt-1","value":6}') },
      verification: { mode: "api_key", verified: true, assurance: "shared_secret" },
      channel: "public",
      correlationId: "88888888-8888-4888-8888-888888888888",
      transaction: transactionFor(client),
    }),
    (error) => error?.code === "IDEMPOTENCY_CONFLICT" && error?.status === 409
  );
  assert.equal(writes.length, 0);
});
