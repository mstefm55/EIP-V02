import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchTenantSetting,
  resolveTenantId,
} from "../src/routes/ui_surface.js";

const TENANT_ID = "33333333-3333-4333-8333-333333333333";

class TenantSettingClient {
  constructor() {
    this.queries = [];
    this.released = false;
    this.currentTenantId = null;
  }

  async query(sql, params = []) {
    const text = String(sql).trim();
    this.queries.push({ sql: text, params });

    if (text === "SELECT set_config('app.current_tenant_id', $1, true)") {
      this.currentTenantId = params[0];
      return { rows: [{ set_config: params[0] }], rowCount: 1 };
    }

    if (text.includes("FROM tenant.tenant_settings")) {
      assert.equal(this.currentTenantId, TENANT_ID);
      assert.deepEqual(params, [TENANT_ID, "OWNER_ADMIN_SHELL_THEME_OVERRIDE"]);
      return {
        rows: [{
          setting_value: { tokens: { accent_primary: "#123456" } },
          updated_at: "2026-08-02T00:00:00.000Z",
        }],
        rowCount: 1,
      };
    }

    if (text === "COMMIT" || text === "ROLLBACK") {
      this.currentTenantId = null;
      return { rows: [], rowCount: 0 };
    }

    return { rows: [], rowCount: 0 };
  }

  release() {
    this.released = true;
  }
}

test("tenant setting reads use transaction-local tenant context", async () => {
  const client = new TenantSettingClient();
  const app = {
    db: {
      async connect() {
        return client;
      },
      async query() {
        throw new Error("tenant.tenant_settings must not use pooled app.db.query directly");
      },
    },
  };

  const row = await fetchTenantSetting(app, {
    tenantId: TENANT_ID.toUpperCase(),
    settingKey: "OWNER_ADMIN_SHELL_THEME_OVERRIDE",
  });

  assert.deepEqual(row.setting_value, { tokens: { accent_primary: "#123456" } });
  assert.equal(client.released, true);
  assert.deepEqual(client.queries.map((query) => query.sql), [
    "BEGIN",
    "SELECT set_config('app.current_tenant_id', $1, true)",
    `SELECT setting_value, updated_at
      FROM tenant.tenant_settings
      WHERE tenant_id = $1
        AND setting_key = $2
        AND setting_status = 'active'
      LIMIT 1`,
    "COMMIT",
  ]);
});

test("public tenant resolution ignores direct query-string tenant ids", async () => {
  const app = {
    db: {
      async query() {
        throw new Error("direct public tenant_id must not trigger database access");
      },
    },
  };

  const tenantId = await resolveTenantId(app, {
    tenantId: TENANT_ID,
    tenantCode: null,
    allowDirectTenantId: false,
  });

  assert.equal(tenantId, null);
});

test("trusted tenant resolution may use a direct server-side tenant id", async () => {
  const tenantId = await resolveTenantId({}, {
    tenantId: TENANT_ID,
    tenantCode: "ignored",
    allowDirectTenantId: true,
  });

  assert.equal(tenantId, TENANT_ID);
});

test("public tenant resolution can use an approved tenant code handle", async () => {
  const app = {
    db: {
      async query(sql, params = []) {
        assert.match(String(sql), /FROM kernel\.tenants/);
        assert.deepEqual(params, ["samara"]);
        return { rows: [{ tenant_id: TENANT_ID }], rowCount: 1 };
      },
    },
  };

  const tenantId = await resolveTenantId(app, {
    tenantId: null,
    tenantCode: "samara",
    allowDirectTenantId: false,
  });

  assert.equal(tenantId, TENANT_ID);
});
