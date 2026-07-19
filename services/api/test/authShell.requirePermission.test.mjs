import test from "node:test";
import assert from "node:assert/strict";
import authShellPlugin from "../src/plugins/authShell.js";

function createAuthShellAppStub() {
  const app = {
    config: {
      AUTH_SESSION_PEPPER: "test-session-pepper",
      AUTH_CSRF_PEPPER: "test-csrf-pepper",
      NODE_ENV: "test",
    },
    db: {
      async query(sql) {
        if (
          sql.includes("information_schema.tables")
          && sql.includes("table_name IN ('auth_device', 'auth_otp_challenge')")
        ) {
          return {
            rowCount: 2,
            rows: [
              { table_name: "auth_device" },
              { table_name: "auth_otp_challenge" },
            ],
          };
        }
        if (
          sql.includes("information_schema.tables")
          && sql.includes("table_name = 'auth_session'")
        ) {
          return { rowCount: 1, rows: [{ "?column?": 1 }] };
        }
        if (sql.includes("information_schema.columns")) {
          return {
            rowCount: 12,
            rows: [
              { column_name: "id" },
              { column_name: "tenant_id" },
              { column_name: "identity_id" },
              { column_name: "device_id" },
              { column_name: "issued_at" },
              { column_name: "expires_at" },
              { column_name: "csrf_secret_hash" },
              { column_name: "ip_address" },
              { column_name: "user_agent_hash" },
              { column_name: "is_revoked" },
              { column_name: "revoked_at" },
              { column_name: "attrs" },
            ],
          };
        }
        throw new Error(`Unexpected query in auth shell test: ${sql}`);
      },
    },
    decorateRequest() {},
    decorate(name, value) {
      this[name] = value;
    },
  };
  return app;
}

test("auth shell requirePermission allows when required code is granted", async () => {
  const app = createAuthShellAppStub();
  await authShellPlugin(app);

  const req = {
    session: {
      id: "session-1",
      tenant_id: "tenant-1",
      identity_id: "identity-1",
      realm: "EIP",
      permission_codes: ["PROCESS_DEF_READ"],
      role_codes: [],
    },
  };

  const result = await app.requirePermission(req, ["PROCESS_DEF_READ"], { realm: "EIP" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.required_permissions, ["PROCESS_DEF_READ"]);
  assert.deepEqual(req.auth.permissions, ["PROCESS_DEF_READ"]);
});

test("auth shell requirePermission fails closed when permission is missing", async () => {
  const app = createAuthShellAppStub();
  await authShellPlugin(app);

  const req = {
    session: {
      id: "session-1",
      tenant_id: "tenant-1",
      identity_id: "identity-1",
      realm: "EIP",
      permission_codes: [],
      role_codes: [],
    },
  };

  const result = await app.requirePermission(req, ["PROCESS_DEF_WRITE"], { realm: "EIP" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, "PERMISSION_REQUIRED");
  assert.deepEqual(result.required_permissions, ["PROCESS_DEF_WRITE"]);
});
