import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConnectionCodeBase,
  buildConnectionCodeCandidate,
  createConnectionProfile,
} from "../src/services/connections/connectionProfile.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const TAXONOMY = Object.freeze({
  CONNECTION_KIND: [{ code: "website" }],
  CONNECTION_ENVIRONMENT: [{ code: "sandbox" }],
});

test("connection codes preserve the V1 name-prefix and numeric-suffix convention", () => {
  assert.equal(buildConnectionCodeBase("My Website"), "my-website");
  assert.equal(buildConnectionCodeCandidate("My Website", 1), "my-website");
  assert.equal(buildConnectionCodeCandidate("My Website", 2), "my-website-2");
  assert.equal(buildConnectionCodeCandidate("My Website", 3), "my-website-3");
  assert.equal(buildConnectionCodeBase("A"), "a-conn");
  assert.equal(buildConnectionCodeBase("  Portal / EU !!!  "), "portal-eu");
});

test("server ignores browser connection_code and retries the next serial on tenant collision", async () => {
  const inserts = [];
  let insertAttempt = 0;

  const client = {
    async query(sql, params = []) {
      const statement = String(sql).trim();
      if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") {
        return { rowCount: 0, rows: [] };
      }
      if (statement.includes("set_config('app.current_tenant_id'")) {
        return { rowCount: 1, rows: [] };
      }
      if (statement.includes("INSERT INTO tenant.tenant_settings")) {
        insertAttempt += 1;
        const profile = JSON.parse(params[3]);
        inserts.push({ key: params[2], profile });
        if (insertAttempt === 1) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [{
            tenant_setting_id: params[0],
            setting_key: params[2],
            setting_value: profile,
            setting_status: params[4],
            created_at: "2026-09-10T00:00:00.000Z",
            updated_at: "2026-09-10T00:00:00.000Z",
          }],
        };
      }
      throw new Error(`Unexpected SQL in test: ${statement.slice(0, 80)}`);
    },
    release() {},
  };

  const pool = {
    async connect() {
      return client;
    },
  };

  const created = await createConnectionProfile(
    pool,
    TENANT_ID,
    {
      identity: {
        connection_name: "Acme Portal",
        connection_code: "operator-manual-code",
        connection_kind: "website",
        environment: "sandbox",
        is_enabled: false,
      },
    },
    TAXONOMY
  );

  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].key, "connection.profile.acme-portal");
  assert.equal(inserts[0].profile.identity.connection_code, "acme-portal");
  assert.equal(inserts[1].key, "connection.profile.acme-portal-2");
  assert.equal(inserts[1].profile.identity.connection_code, "acme-portal-2");
  assert.equal(created.identity.connection_code, "acme-portal-2");
  assert.equal(created.identity.is_enabled, false);
  assert.equal(created.setting_status, "disabled");
});

test("new connections still fail closed when activation is requested at creation", async () => {
  const pool = {
    async connect() {
      throw new Error("database should not be reached for invalid enabled create");
    },
  };

  await assert.rejects(
    () => createConnectionProfile(
      pool,
      TENANT_ID,
      {
        identity: {
          connection_name: "Unsafe Enabled",
          connection_kind: "website",
          environment: "sandbox",
          is_enabled: true,
        },
      },
      TAXONOMY
    ),
    (error) => error?.code === "CONNECTION_ACTIVATION_REQUIRES_DRAFT"
  );
});
