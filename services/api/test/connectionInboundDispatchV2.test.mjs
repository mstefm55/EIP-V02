import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptInboundRequest,
  dispatchInboundWithClient,
} from "../src/services/connections/connectionInboundDispatch.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const RECEIPT = "22222222-2222-4222-8222-222222222222";

function profile(mode = "mapped") {
  return {
    identity: { connection_code: "orders_api", direction: "inbound" },
    routing: {
      mapping_mode: mode,
      mapping: mode === "mapped"
        ? {
            service_object: {
              object_type: "ORDER",
              code: "$body.order_id",
              attrs: { external_id: "$body.order_id", amount: "$body.amount" },
            },
          }
        : {},
    },
  };
}

test("mapped dispatch delegates process selection to createInstance through Service Object metadata", async () => {
  const calls = [];
  const result = await dispatchInboundWithClient({
    client: {},
    tenantId: TENANT,
    profile: profile(),
    rawBody: Buffer.from('{"order_id":"ORD-1","amount":25}'),
    receipt: { receipt_id: RECEIPT },
    createProcessInstance: async (client, input) => {
      calls.push({ client, input });
      return {
        ok: true,
        service_object: { id: "33333333-3333-4333-8333-333333333333" },
        item: {
          id: "44444444-4444-4444-8444-444444444444",
          service_object_id: "33333333-3333-4333-8333-333333333333",
          process_def_id: "55555555-5555-4555-8555-555555555555",
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.tenantId, TENANT);
  assert.equal(calls[0].input.processDefId, undefined);
  assert.equal(calls[0].input.code, undefined);
  assert.equal(calls[0].input.serviceObject.object_type, "ORDER");
  assert.equal(calls[0].input.serviceObject.code, "ORD-1");
  assert.equal(calls[0].input.idempotencyKey, `connection-inbound:${RECEIPT}`);
  assert.equal(result.status, "PROCESS_STARTED");
  assert.equal(result.process_instance_id, "44444444-4444-4444-8444-444444444444");
});

test("passthrough dispatch never invokes the Process Engine", async () => {
  let calls = 0;
  const result = await dispatchInboundWithClient({
    client: {},
    tenantId: TENANT,
    profile: profile("passthrough"),
    rawBody: Buffer.from('{"value":1}'),
    receipt: { receipt_id: RECEIPT },
    createProcessInstance: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.status, "NOT_BOUND");
});

test("receipt claim dispatch and evidence write share one tenant transaction", async () => {
  const order = [];
  const client = { marker: "tenant-client" };
  const result = await acceptInboundRequest({
    pool: {},
    tenantId: TENANT,
    profile: profile(),
    request: { rawBody: Buffer.from('{"order_id":"ORD-1","amount":25}') },
    verification: { mode: "api_key", verified: true },
    channel: "public",
    correlationId: "66666666-6666-4666-8666-666666666666",
    transaction: async (_pool, tenantId, callback) => {
      assert.equal(tenantId, TENANT);
      order.push("transaction");
      return callback(client);
    },
    claimReceipt: async (input) => {
      assert.equal(input.client, client);
      order.push("claim");
      return { duplicate: false, receipt_id: RECEIPT, accepted_at: "2026-09-09T00:00:00.000Z" };
    },
    dispatchRequest: async (input) => {
      assert.equal(input.client, client);
      order.push("dispatch");
      return {
        status: "PROCESS_STARTED",
        service_object_id: "33333333-3333-4333-8333-333333333333",
        process_instance_id: "44444444-4444-4444-8444-444444444444",
        process_def_id: "55555555-5555-4555-8555-555555555555",
      };
    },
    writeDispatchEvidence: async (input) => {
      assert.equal(input.client, client);
      order.push("evidence");
      return { ...input.dispatch, recorded_at: "2026-09-09T00:00:01.000Z" };
    },
  });

  assert.deepEqual(order, ["transaction", "claim", "dispatch", "evidence"]);
  assert.equal(result.duplicate, false);
  assert.equal(result.dispatch.status, "PROCESS_STARTED");
});

test("duplicate receipt suppresses dispatch inside the same acceptance boundary", async () => {
  let dispatched = 0;
  let evidenceWrites = 0;
  const result = await acceptInboundRequest({
    pool: {},
    tenantId: TENANT,
    profile: profile(),
    request: { rawBody: Buffer.from('{"order_id":"ORD-1"}') },
    transaction: async (_pool, _tenantId, callback) => callback({}),
    claimReceipt: async () => ({
      duplicate: true,
      receipt_id: RECEIPT,
      dispatch: {
        status: "PROCESS_STARTED",
        service_object_id: "33333333-3333-4333-8333-333333333333",
      },
    }),
    dispatchRequest: async () => {
      dispatched += 1;
      return { status: "PROCESS_STARTED" };
    },
    writeDispatchEvidence: async () => {
      evidenceWrites += 1;
      return {};
    },
  });

  assert.equal(dispatched, 0);
  assert.equal(evidenceWrites, 0);
  assert.equal(result.duplicate, true);
  assert.equal(result.dispatch.status, "PROCESS_STARTED");
});

test("dispatch failure rejects the acceptance transaction instead of committing a suppressing receipt", async () => {
  let evidenceWrites = 0;
  await assert.rejects(
    () => acceptInboundRequest({
      pool: {},
      tenantId: TENANT,
      profile: profile(),
      request: { rawBody: Buffer.from('{"order_id":"ORD-1"}') },
      transaction: async (_pool, _tenantId, callback) => callback({}),
      claimReceipt: async () => ({ duplicate: false, receipt_id: RECEIPT }),
      dispatchRequest: async () => {
        throw new Error("dispatch failed");
      },
      writeDispatchEvidence: async () => {
        evidenceWrites += 1;
        return {};
      },
    }),
    /dispatch failed/
  );
  assert.equal(evidenceWrites, 0);
});
