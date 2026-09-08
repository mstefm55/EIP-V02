import assert from "node:assert/strict";
import test from "node:test";

import { revokeSecret } from "../src/services/connections/connectionSecretStore.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

function profile({ enabled = true } = {}) {
  return {
    identity: {
      connection_code: "orders",
      direction: "inbound",
      is_enabled: enabled,
    },
    verification: { mode: "api_key" },
    outbound: { auth_mode: "" },
  };
}

function clientFor({ enabled = true, settingStatus = enabled ? "active" : "disabled" } = {}) {
  const calls = [];
  let revokeWrites = 0;
  const client = {
    async query(sql, params = []) {
      const source = String(sql);
      calls.push({ sql: source, params });
      if (source.includes("FROM tenant.tenant_settings")) {
        return {
          rowCount: 1,
          rows: [{ setting_value: profile({ enabled }), setting_status: settingStatus }],
        };
      }
      if (source.includes("FROM eip_core.dropdown_list")) {
        return { rowCount: 1, rows: [{ ok: 1 }] };
      }
      if (source.includes("UPDATE tenant.connection_secret")) {
        revokeWrites += 1;
        return {
          rowCount: 1,
          rows: [{
            status: "revoked",
            version: 2,
            fingerprint: "safe-fingerprint",
            created_at: "2026-09-09T00:00:00.000Z",
            revoked_at: "2026-09-09T01:00:00.000Z",
          }],
        };
      }
      throw new Error(`Unexpected query: ${source}`);
    },
  };
  return { client, calls, revokeWrites: () => revokeWrites };
}

test("required credential cannot be revoked while the connection is enabled", async () => {
  const fixture = clientFor({ enabled: true });

  await assert.rejects(
    () => revokeSecret({
      client: fixture.client,
      tenantId: TENANT,
      connectionCode: "orders",
      secretKind: "api_key",
      actorIdentityId: ACTOR,
    }),
    (error) =>
      error?.code === "CONNECTION_SECRET_REQUIRED_BY_ACTIVE_PROFILE"
      && error?.status === 409
  );

  assert.equal(fixture.revokeWrites(), 0);
});

test("required credential may be revoked after the connection is disabled", async () => {
  const fixture = clientFor({ enabled: false, settingStatus: "disabled" });

  const result = await revokeSecret({
    client: fixture.client,
    tenantId: TENANT,
    connectionCode: "orders",
    secretKind: "api_key",
    actorIdentityId: ACTOR,
  });

  assert.equal(fixture.revokeWrites(), 1);
  assert.equal(result.configured, false);
  assert.equal(result.status, "revoked");
});

test("an enabled profile may revoke a credential it does not currently require", async () => {
  const fixture = clientFor({ enabled: true });

  const result = await revokeSecret({
    client: fixture.client,
    tenantId: TENANT,
    connectionCode: "orders",
    secretKind: "bearer_token",
    actorIdentityId: ACTOR,
  });

  assert.equal(fixture.revokeWrites(), 1);
  assert.equal(result.status, "revoked");
});

test("setting-status drift fails closed when profile metadata says disabled but storage lifecycle is active", async () => {
  const fixture = clientFor({ enabled: false, settingStatus: "active" });

  await assert.rejects(
    () => revokeSecret({
      client: fixture.client,
      tenantId: TENANT,
      connectionCode: "orders",
      secretKind: "api_key",
      actorIdentityId: ACTOR,
    }),
    (error) => error?.code === "CONNECTION_SECRET_REQUIRED_BY_ACTIVE_PROFILE"
  );

  assert.equal(fixture.revokeWrites(), 0);
});
