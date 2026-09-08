import assert from "node:assert/strict";
import test from "node:test";

import { deprecateConnectionProfile } from "../src/services/connections/connectionLifecycle.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

function buildPool({ existing = true } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("SELECT tenant_setting_id")) {
        return existing
          ? { rowCount: 1, rows: [{ tenant_setting_id: "setting-1", setting_status: "active", setting_value: {} }] }
          : { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  return {
    calls,
    pool: { async connect() { return client; } },
  };
}

test("connection deprecation is scoped by authenticated tenant transaction and revokes active secrets", async () => {
  const { pool, calls } = buildPool();
  const result = await deprecateConnectionProfile(pool, TENANT, "sample_conn", ACTOR);

  assert.equal(result.connection_code, "sample_conn");
  assert.equal(result.status, "deprecated");

  const setConfig = calls.find((entry) => entry.sql.includes("set_config('app.current_tenant_id'"));
  assert.deepEqual(setConfig?.params, [TENANT]);

  const profileUpdate = calls.find((entry) => entry.sql.includes("UPDATE tenant.tenant_settings"));
  assert.ok(profileUpdate);
  assert.equal(profileUpdate.params[0], TENANT);
  assert.equal(profileUpdate.params[1], "connection.profile.sample_conn");
  assert.equal(profileUpdate.params[3], ACTOR);
  assert.match(profileUpdate.sql, /setting_status = 'deprecated'/);
  assert.match(profileUpdate.sql, /identity,is_enabled/);

  const secretUpdate = calls.find((entry) => entry.sql.includes("UPDATE tenant.connection_secret"));
  assert.ok(secretUpdate);
  assert.deepEqual(secretUpdate.params, [TENANT, "sample_conn", ACTOR]);
  assert.match(secretUpdate.sql, /status = 'revoked'/);
  assert.match(secretUpdate.sql, /status = 'active'/);

  assert.ok(calls.some((entry) => entry.sql === "COMMIT"));
});

test("connection deprecation fails closed for unknown profile", async () => {
  const { pool, calls } = buildPool({ existing: false });

  await assert.rejects(
    () => deprecateConnectionProfile(pool, TENANT, "missing_conn", ACTOR),
    (error) => error?.code === "CONNECTION_NOT_FOUND" && error?.status === 404
  );

  assert.ok(calls.some((entry) => entry.sql === "ROLLBACK"));
  assert.equal(calls.some((entry) => entry.sql.includes("UPDATE tenant.connection_secret")), false);
});
