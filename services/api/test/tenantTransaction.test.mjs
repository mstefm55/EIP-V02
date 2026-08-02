import assert from "node:assert/strict";
import test from "node:test";

import {
  TenantTransactionError,
  normalizeTenantId,
  withTenantTransaction,
} from "../src/db/tenantTransaction.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

class FakeClient {
  constructor({ failOnCommit = false, failOnRollback = false } = {}) {
    this.failOnCommit = failOnCommit;
    this.failOnRollback = failOnRollback;
    this.currentTenantId = null;
    this.queries = [];
    this.released = false;
  }

  async query(sql, params = []) {
    const text = String(sql).trim();
    this.queries.push({ sql: text, params });

    if (text === "COMMIT") {
      if (this.failOnCommit) throw new Error("synthetic commit failure");
      this.currentTenantId = null;
      return { rows: [], rowCount: 0 };
    }

    if (text === "ROLLBACK") {
      if (this.failOnRollback) throw new Error("synthetic rollback failure");
      this.currentTenantId = null;
      return { rows: [], rowCount: 0 };
    }

    if (text === "SELECT set_config('app.current_tenant_id', $1, true)") {
      this.currentTenantId = params[0];
      return { rows: [{ set_config: params[0] }], rowCount: 1 };
    }

    if (text === "SELECT current_setting('app.current_tenant_id', true) AS tenant_id") {
      return {
        rows: [{ tenant_id: this.currentTenantId }],
        rowCount: this.currentTenantId ? 1 : 0,
      };
    }

    return { rows: [], rowCount: 0 };
  }

  release() {
    this.released = true;
  }
}

class FakePool {
  constructor(client = new FakeClient()) {
    this.client = client;
    this.connectCalls = 0;
  }

  async connect() {
    this.connectCalls += 1;
    return this.client;
  }
}

test("normalizeTenantId accepts canonical UUID values only", () => {
  assert.equal(normalizeTenantId(TENANT_A.toUpperCase()), TENANT_A);
  assert.throws(
    () => normalizeTenantId("not-a-tenant"),
    (error) => error instanceof TenantTransactionError && error.code === "TENANT_CONTEXT_INVALID"
  );
});

test("withTenantTransaction uses one leased client and commits", async () => {
  const client = new FakeClient();
  const pool = new FakePool(client);

  const result = await withTenantTransaction(pool, TENANT_A, async (callbackClient, context) => {
    assert.equal(callbackClient, client);
    assert.equal(context.tenantId, TENANT_A);
    const setting = await callbackClient.query(
      "SELECT current_setting('app.current_tenant_id', true) AS tenant_id"
    );
    assert.equal(setting.rows[0].tenant_id, TENANT_A);
    return "ok";
  });

  assert.equal(result, "ok");
  assert.equal(pool.connectCalls, 1);
  assert.equal(client.released, true);
  assert.equal(client.currentTenantId, null);
  assert.deepEqual(client.queries.map((query) => query.sql), [
    "BEGIN",
    "SELECT set_config('app.current_tenant_id', $1, true)",
    "SELECT current_setting('app.current_tenant_id', true) AS tenant_id",
    "COMMIT",
  ]);
  assert.deepEqual(client.queries[1].params, [TENANT_A]);
});

test("withTenantTransaction rolls back and preserves callback errors", async () => {
  const client = new FakeClient();
  const pool = new FakePool(client);
  const callbackError = new Error("synthetic callback failure");

  let thrown;
  try {
    await withTenantTransaction(pool, TENANT_A, async () => {
      throw callbackError;
    });
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown, callbackError);
  assert.equal(client.released, true);
  assert.equal(client.currentTenantId, null);
  assert.deepEqual(client.queries.map((query) => query.sql), [
    "BEGIN",
    "SELECT set_config('app.current_tenant_id', $1, true)",
    "ROLLBACK",
  ]);
});

test("withTenantTransaction rejects missing or invalid tenant ids before opening a client", async () => {
  const pool = new FakePool();

  await assert.rejects(
    () => withTenantTransaction(pool, "", async () => "never"),
    (error) => error instanceof TenantTransactionError && error.code === "TENANT_CONTEXT_REQUIRED"
  );
  await assert.rejects(
    () => withTenantTransaction(pool, "11111111-1111-4111-8111-111111111111'; SELECT 1; --", async () => "never"),
    (error) => error instanceof TenantTransactionError && error.code === "TENANT_CONTEXT_INVALID"
  );
  assert.equal(pool.connectCalls, 0);
});

test("withTenantTransaction clears transaction-local tenant state after pool reuse", async () => {
  const client = new FakeClient();
  const pool = new FakePool(client);

  await withTenantTransaction(pool, TENANT_A, async (callbackClient) => {
    const setting = await callbackClient.query(
      "SELECT current_setting('app.current_tenant_id', true) AS tenant_id"
    );
    assert.equal(setting.rows[0].tenant_id, TENANT_A);
  });
  assert.equal(client.currentTenantId, null);

  await withTenantTransaction(pool, TENANT_B, async (callbackClient) => {
    const setting = await callbackClient.query(
      "SELECT current_setting('app.current_tenant_id', true) AS tenant_id"
    );
    assert.equal(setting.rows[0].tenant_id, TENANT_B);
  });

  assert.equal(pool.connectCalls, 2);
  assert.equal(client.currentTenantId, null);
  assert.deepEqual(
    client.queries
      .filter((query) => query.sql === "SELECT set_config('app.current_tenant_id', $1, true)")
      .map((query) => query.params[0]),
    [TENANT_A, TENANT_B]
  );
});

test("withTenantTransaction preserves SQL parameterization for tenant context", async () => {
  const client = new FakeClient();
  const pool = new FakePool(client);

  await withTenantTransaction(pool, TENANT_A, async () => "ok");

  const setConfigQuery = client.queries.find((query) =>
    query.sql === "SELECT set_config('app.current_tenant_id', $1, true)"
  );
  assert.ok(setConfigQuery);
  assert.equal(setConfigQuery.sql.includes(TENANT_A), false);
  assert.deepEqual(setConfigQuery.params, [TENANT_A]);
});
