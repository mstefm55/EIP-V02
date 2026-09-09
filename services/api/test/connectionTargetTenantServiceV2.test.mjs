import assert from "node:assert/strict";
import test from "node:test";

import {
  listConnectionTargetTenants,
  resolveConnectionTargetTenant,
  toTargetTenantDto,
} from "../src/services/connections/connectionTargetTenant.js";

const ROW = Object.freeze({
  tenant_id: "11111111-1111-4111-8111-111111111111",
  tenant_code: "tenant-a",
  tenant_name: "Tenant A",
  tenant_status: "active",
  tenancy_mode: "POOL",
});

test("target tenant DTO uses the canonical kernel tenant fields", () => {
  assert.deepEqual(toTargetTenantDto(ROW), {
    id: ROW.tenant_id,
    code: ROW.tenant_code,
    name: ROW.tenant_name,
    status: ROW.tenant_status,
    tenancy_mode: ROW.tenancy_mode,
  });
});

test("target tenant catalogue queries only canonical kernel.tenants columns", async () => {
  let sql = "";
  const pool = {
    query: async (statement) => {
      sql = statement;
      return { rows: [ROW], rowCount: 1 };
    },
  };

  const items = await listConnectionTargetTenants(pool);

  assert.deepEqual(items, [toTargetTenantDto(ROW)]);
  assert.match(sql, /tenant_id/);
  assert.match(sql, /tenant_code/);
  assert.match(sql, /tenant_name/);
  assert.match(sql, /tenant_status/);
  assert.match(sql, /tenancy_mode/);
  assert.doesNotMatch(sql, /tenant_kind/);
  assert.doesNotMatch(sql, /tenancy_model/);
});

test("target tenant resolution binds tenant code and excludes inactive tenants", async () => {
  let sql = "";
  let params = null;
  const pool = {
    query: async (statement, values) => {
      sql = statement;
      params = values;
      return { rows: [ROW], rowCount: 1 };
    },
  };

  const target = await resolveConnectionTargetTenant(pool, " tenant-a ");

  assert.deepEqual(target, toTargetTenantDto(ROW));
  assert.deepEqual(params, ["tenant-a"]);
  assert.match(sql, /tenant_code = \$1/);
  assert.match(sql, /tenant_status = 'active'/);
  assert.match(sql, /tenancy_mode/);
  assert.doesNotMatch(sql, /tenant_kind/);
  assert.doesNotMatch(sql, /tenancy_model/);
});
