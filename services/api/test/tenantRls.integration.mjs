#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { withTenantTransaction } from "../src/db/tenantTransaction.js";
import { buildMigrations, runMigrationsWithLedger } from "../scripts/migrationLedger.mjs";

const { Pool } = pg;

const EXPECTED_DATABASE_NAME = "eip_v2_rls_test";
const EXPECTED_POLICIES = Object.freeze([
  "tenant_settings_delete_isolation",
  "tenant_settings_insert_isolation",
  "tenant_settings_select_isolation",
  "tenant_settings_update_isolation",
]);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const RUN_ID = Date.now();
const KEY_PREFIX = `WAVE_2A_RLS_${RUN_ID}`;
const SELECT_KEY = `${KEY_PREFIX}_SELECT`;
const UPDATE_KEY = `${KEY_PREFIX}_UPDATE`;
const REASSIGN_KEY = `${KEY_PREFIX}_REASSIGN`;
const DELETE_A_KEY = `${KEY_PREFIX}_DELETE_A`;
const DELETE_B_KEY = `${KEY_PREFIX}_DELETE_B`;
const ROLLBACK_KEY = `${KEY_PREFIX}_ROLLBACK`;

function requireDisposableLocalDatabaseUrl() {
  const connectionString =
    process.env.EIP_RLS_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    buildConnectionStringFromDiscreteEnv(process.env);
  if (!connectionString) {
    throw new Error(
      "EIP_RLS_TEST_DATABASE_URL, DATABASE_URL, or discrete DB_* variables are required for the tenant RLS integration suite. Use a disposable local PostgreSQL database."
    );
  }

  const url = new URL(connectionString);
  const host = url.hostname.toLowerCase();
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const expectedUser = decodeURIComponent(url.username);
  const allowRemote = String(process.env.EIP_RLS_TEST_ALLOW_REMOTE || "").toLowerCase() === "true";

  if (!allowRemote && !["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(
      "Refusing to run tenant RLS integration suite against a non-local database without EIP_RLS_TEST_ALLOW_REMOTE=true."
    );
  }

  if (databaseName !== EXPECTED_DATABASE_NAME) {
    throw new Error(
      `Refusing to run tenant RLS integration suite against database ${databaseName || "[missing]"}. Expected ${EXPECTED_DATABASE_NAME}.`
    );
  }

  if (!expectedUser) {
    throw new Error("EIP_RLS_TEST_DATABASE_URL must include the intended disposable application role username.");
  }

  return { connectionString, expectedUser, expectedDatabase: databaseName };
}

function buildConnectionStringFromDiscreteEnv(env) {
  const host = env.DB_HOST || env.DATABASE_HOST || env.PGHOST;
  const port = env.DB_PORT || env.DATABASE_PORT || env.PGPORT || "5432";
  const user = env.DB_USER || env.DATABASE_USER || env.PGUSER;
  const password = env.DB_PASSWORD || env.DATABASE_PASSWORD || env.PGPASSWORD;
  const database = env.DB_DATABASE || env.DATABASE_NAME || env.PGDATABASE;

  if (!host || !user || !database) return null;

  const credentials = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);
  return `postgresql://${credentials}@${host}:${port}/${encodeURIComponent(database)}`;
}

function isUnsetTenantContext(value) {
  return value === null || value === "";
}

function assertRowsOnlyTenant(rows, tenantId) {
  assert.ok(rows.length > 0);
  assert.deepEqual([...new Set(rows.map((row) => row.tenant_id))], [tenantId]);
}

async function loadMigrations() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, "../../../db/migrations");
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^v2_\d+.*\.sql$/i.test(entry.name))
      .map(async (entry) => ({
        filename: entry.name,
        sql: await fs.readFile(path.join(migrationsDir, entry.name), "utf8"),
      }))
  );
  return buildMigrations(files);
}

async function applyCurrentMigrations(pool) {
  const client = await pool.connect();
  try {
    const migrations = await loadMigrations();
    return await runMigrationsWithLedger(client, migrations);
  } finally {
    client.release();
  }
}

async function assertRoleSafety(pool, { expectedUser, expectedDatabase }) {
  const result = await pool.query(
    `
    SELECT
      current_user,
      current_database() AS current_database,
      rolsuper,
      rolbypassrls
    FROM pg_roles
    WHERE rolname = current_user
    `
  );

  assert.equal(result.rowCount, 1, "current_user must resolve to exactly one pg_roles row");
  const role = result.rows[0];
  assert.equal(role.current_user, expectedUser, "current_user must match the disposable application role in the test URL");
  assert.equal(role.current_database, expectedDatabase, "current database must be the disposable RLS test database");
  assert.equal(role.rolsuper, false, "tested role must not be superuser");
  assert.equal(role.rolbypassrls, false, "tested role must not have BYPASSRLS");

  return {
    current_user: role.current_user,
    rolsuper: role.rolsuper,
    rolbypassrls: role.rolbypassrls,
  };
}

async function assertRlsMetadata(pool) {
  const tableResult = await pool.query(
    `
    SELECT
      c.relrowsecurity,
      c.relforcerowsecurity,
      pg_catalog.pg_get_userbyid(c.relowner) AS table_owner
    FROM pg_class AS c
    JOIN pg_namespace AS n
      ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relname = $2
    `,
    ["tenant", "tenant_settings"]
  );

  assert.equal(tableResult.rowCount, 1, "tenant.tenant_settings metadata row must exist");
  const table = tableResult.rows[0];
  assert.equal(table.relrowsecurity, true, "tenant.tenant_settings must have RLS enabled");
  assert.equal(table.relforcerowsecurity, true, "tenant.tenant_settings must have FORCE RLS enabled");

  const policyResult = await pool.query(
    `
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = $1
      AND tablename = $2
    ORDER BY policyname
    `,
    ["tenant", "tenant_settings"]
  );
  const policyNames = policyResult.rows.map((row) => row.policyname);
  assert.deepEqual(policyNames, EXPECTED_POLICIES, "tenant.tenant_settings must expose the expected Wave 2A policies only");

  const currentUserResult = await pool.query("SELECT current_user");
  const currentUser = currentUserResult.rows[0].current_user;
  assert.equal(table.table_owner, currentUser, "tested role must own tenant.tenant_settings to prove FORCE RLS constrains table-owner access");

  return {
    enabled: table.relrowsecurity,
    forced: table.relforcerowsecurity,
    table_owner: table.table_owner,
    policy_names: policyNames,
  };
}

async function upsertTenants(pool) {
  await pool.query(
    `
    INSERT INTO kernel.tenants (tenant_id, tenant_code, tenant_name)
    VALUES
      ($1, $2, $3),
      ($4, $5, $6)
    `,
    [
      TENANT_A,
      `wave-2a-a-${RUN_ID}`,
      "Wave 2A Tenant A",
      TENANT_B,
      `wave-2a-b-${RUN_ID}`,
      "Wave 2A Tenant B",
    ]
  );
}

async function insertTenantSetting(pool, tenantId, key, value) {
  return withTenantTransaction(pool, tenantId, (client) =>
    client.query(
      `
      INSERT INTO tenant.tenant_settings (
        tenant_setting_id,
        tenant_id,
        setting_key,
        setting_value,
        setting_status
      )
      VALUES ($1, $2, $3, $4::jsonb, 'active')
      RETURNING tenant_id, setting_key, setting_value
      `,
      [randomUUID(), tenantId, key, JSON.stringify(value)]
    )
  );
}

async function selectTenantSettings(pool, tenantId, keys) {
  return withTenantTransaction(pool, tenantId, (client) =>
    client.query(
      `
      SELECT tenant_id, setting_key, setting_value
      FROM tenant.tenant_settings
      WHERE setting_key = ANY($1::text[])
      ORDER BY setting_key
      `,
      [keys]
    )
  );
}

async function assertMissingContextReturnsNoRows(pool) {
  const result = await pool.query(
    `
    SELECT tenant_id, setting_key
    FROM tenant.tenant_settings
    WHERE setting_key LIKE $1
    ORDER BY setting_key
    `,
    [`${KEY_PREFIX}%`]
  );
  assert.equal(result.rowCount, 0);
}

async function assertTenantACanInsertOwnRow(pool) {
  const result = await insertTenantSetting(pool, TENANT_A, SELECT_KEY, { owner: "A", action: "insert" });
  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0].tenant_id, TENANT_A);
  assert.deepEqual(result.rows[0].setting_value, { owner: "A", action: "insert" });
}

async function assertTenantACannotInsertTenantBRow(pool) {
  await assert.rejects(
    () => withTenantTransaction(pool, TENANT_A, (client) =>
      client.query(
        `
        INSERT INTO tenant.tenant_settings (
          tenant_setting_id,
          tenant_id,
          setting_key,
          setting_value,
          setting_status
        )
        VALUES ($1, $2, $3, $4::jsonb, 'active')
        `,
        [randomUUID(), TENANT_B, `${KEY_PREFIX}_BAD_INSERT`, JSON.stringify({ owner: "B" })]
      )
    ),
    /row-level security|violates row-level security|new row violates/
  );
}

async function assertTenantACanSelectOwnRow(pool) {
  const result = await withTenantTransaction(pool, TENANT_A, (client) =>
    client.query(
      `
      SELECT tenant_id, setting_value
      FROM tenant.tenant_settings
      WHERE tenant_id = $1
        AND setting_key = $2
      `,
      [TENANT_A, SELECT_KEY]
    )
  );
  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0].tenant_id, TENANT_A);
}

async function assertTenantACannotSelectTenantBRow(pool) {
  const result = await withTenantTransaction(pool, TENANT_A, (client) =>
    client.query(
      `
      SELECT tenant_id, setting_value
      FROM tenant.tenant_settings
      WHERE tenant_id = $1
        AND setting_key = $2
      `,
      [TENANT_B, SELECT_KEY]
    )
  );
  assert.equal(result.rowCount, 0);
}

async function assertTenantACanUpdateOwnRow(pool) {
  await insertTenantSetting(pool, TENANT_A, UPDATE_KEY, { owner: "A", version: 1 });
  const result = await withTenantTransaction(pool, TENANT_A, (client) =>
    client.query(
      `
      UPDATE tenant.tenant_settings
      SET setting_value = $1::jsonb,
          updated_at = now()
      WHERE tenant_id = $2
        AND setting_key = $3
      RETURNING tenant_id, setting_value
      `,
      [JSON.stringify({ owner: "A", version: 2 }), TENANT_A, UPDATE_KEY]
    )
  );
  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.rows[0].setting_value, { owner: "A", version: 2 });
}

async function assertTenantACannotUpdateTenantBRow(pool) {
  const result = await withTenantTransaction(pool, TENANT_A, (client) =>
    client.query(
      `
      UPDATE tenant.tenant_settings
      SET setting_value = $1::jsonb,
          updated_at = now()
      WHERE tenant_id = $2
        AND setting_key = $3
      RETURNING tenant_id, setting_value
      `,
      [JSON.stringify({ owner: "A", illegal: true }), TENANT_B, SELECT_KEY]
    )
  );
  assert.equal(result.rowCount, 0);

  const tenantB = await withTenantTransaction(pool, TENANT_B, (client) =>
    client.query(
      `
      SELECT setting_value
      FROM tenant.tenant_settings
      WHERE tenant_id = $1
        AND setting_key = $2
      `,
      [TENANT_B, SELECT_KEY]
    )
  );
  assert.deepEqual(tenantB.rows[0].setting_value, { owner: "B", action: "insert" });
}

async function assertTenantACannotReassignTenantId(pool) {
  await insertTenantSetting(pool, TENANT_A, REASSIGN_KEY, { owner: "A", reassignment: "before" });
  await assert.rejects(
    () => withTenantTransaction(pool, TENANT_A, (client) =>
      client.query(
        `
        UPDATE tenant.tenant_settings
        SET tenant_id = $1,
            updated_at = now()
        WHERE tenant_id = $2
          AND setting_key = $3
        `,
        [TENANT_B, TENANT_A, REASSIGN_KEY]
      )
    ),
    /row-level security|violates row-level security|new row violates/
  );

  const tenantA = await withTenantTransaction(pool, TENANT_A, (client) =>
    client.query(
      `
      SELECT tenant_id
      FROM tenant.tenant_settings
      WHERE tenant_id = $1
        AND setting_key = $2
      `,
      [TENANT_A, REASSIGN_KEY]
    )
  );
  assert.equal(tenantA.rowCount, 1);
}

async function assertTenantACanDeleteOwnRow(pool) {
  await insertTenantSetting(pool, TENANT_A, DELETE_A_KEY, { owner: "A", delete: true });
  const result = await withTenantTransaction(pool, TENANT_A, (client) =>
    client.query(
      `
      DELETE FROM tenant.tenant_settings
      WHERE tenant_id = $1
        AND setting_key = $2
      RETURNING tenant_id, setting_key
      `,
      [TENANT_A, DELETE_A_KEY]
    )
  );
  assert.equal(result.rowCount, 1);

  const verify = await withTenantTransaction(pool, TENANT_A, (client) =>
    client.query(
      `
      SELECT tenant_id
      FROM tenant.tenant_settings
      WHERE tenant_id = $1
        AND setting_key = $2
      `,
      [TENANT_A, DELETE_A_KEY]
    )
  );
  assert.equal(verify.rowCount, 0);
}

async function assertTenantACannotDeleteTenantBRow(pool) {
  await insertTenantSetting(pool, TENANT_B, DELETE_B_KEY, { owner: "B", delete: false });
  const result = await withTenantTransaction(pool, TENANT_A, (client) =>
    client.query(
      `
      DELETE FROM tenant.tenant_settings
      WHERE tenant_id = $1
        AND setting_key = $2
      RETURNING tenant_id, setting_key
      `,
      [TENANT_B, DELETE_B_KEY]
    )
  );
  assert.equal(result.rowCount, 0);

  const tenantB = await withTenantTransaction(pool, TENANT_B, (client) =>
    client.query(
      `
      SELECT tenant_id
      FROM tenant.tenant_settings
      WHERE tenant_id = $1
        AND setting_key = $2
      `,
      [TENANT_B, DELETE_B_KEY]
    )
  );
  assert.equal(tenantB.rowCount, 1);
}

async function assertContextDisappearsAfterCommit(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [TENANT_A]);
    const during = await client.query(
      "SELECT current_setting('app.current_tenant_id', true) AS tenant_id"
    );
    assert.equal(during.rows[0].tenant_id, TENANT_A);
    await client.query("COMMIT");

    const after = await client.query(
      "SELECT current_setting('app.current_tenant_id', true) AS tenant_id"
    );
    assert.equal(isUnsetTenantContext(after.rows[0].tenant_id), true);

    const missingContext = await client.query(
      `
      SELECT tenant_id
      FROM tenant.tenant_settings
      WHERE setting_key LIKE $1
      `,
      [`${KEY_PREFIX}%`]
    );
    assert.equal(missingContext.rowCount, 0);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertContextDisappearsAfterRollback(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [TENANT_A]);
    const during = await client.query(
      "SELECT current_setting('app.current_tenant_id', true) AS tenant_id"
    );
    assert.equal(during.rows[0].tenant_id, TENANT_A);
    await client.query("ROLLBACK");

    const after = await client.query(
      "SELECT current_setting('app.current_tenant_id', true) AS tenant_id"
    );
    assert.equal(isUnsetTenantContext(after.rows[0].tenant_id), true);

    const missingContext = await client.query(
      `
      SELECT tenant_id
      FROM tenant.tenant_settings
      WHERE setting_key LIKE $1
      `,
      [`${KEY_PREFIX}%`]
    );
    assert.equal(missingContext.rowCount, 0);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertPooledConnectionReuseIsSafe(pool) {
  const tenantA = await selectTenantSettings(pool, TENANT_A, [SELECT_KEY, UPDATE_KEY, REASSIGN_KEY]);
  assertRowsOnlyTenant(tenantA.rows, TENANT_A);

  const afterTenantA = await pool.query(
    "SELECT current_setting('app.current_tenant_id', true) AS tenant_id"
  );
  assert.equal(isUnsetTenantContext(afterTenantA.rows[0].tenant_id), true);

  const missingContext = await pool.query(
    `
    SELECT tenant_id
    FROM tenant.tenant_settings
    WHERE setting_key LIKE $1
    `,
    [`${KEY_PREFIX}%`]
  );
  assert.equal(missingContext.rowCount, 0);

  const tenantB = await selectTenantSettings(pool, TENANT_B, [SELECT_KEY, DELETE_B_KEY]);
  assertRowsOnlyTenant(tenantB.rows, TENANT_B);
}

async function assertSqlFailureRollsBackAndDoesNotLeak(pool) {
  let originalError = null;
  try {
    await withTenantTransaction(pool, TENANT_A, async (client) => {
      await client.query(
        `
        INSERT INTO tenant.tenant_settings (
          tenant_setting_id,
          tenant_id,
          setting_key,
          setting_value,
          setting_status
        )
        VALUES ($1, $2, $3, $4::jsonb, 'active')
        `,
        [randomUUID(), TENANT_A, ROLLBACK_KEY, JSON.stringify({ shouldRollback: true })]
      );
      await client.query("SELECT missing_column FROM tenant.tenant_settings WHERE setting_key = $1", [
        ROLLBACK_KEY,
      ]);
    });
  } catch (error) {
    originalError = error;
  }
  assert.ok(originalError);
  assert.match(originalError.message, /missing_column/);

  const afterFailure = await pool.query(
    "SELECT current_setting('app.current_tenant_id', true) AS tenant_id"
  );
  assert.equal(isUnsetTenantContext(afterFailure.rows[0].tenant_id), true);

  const rolledBack = await withTenantTransaction(pool, TENANT_A, (client) =>
    client.query(
      `
      SELECT tenant_id
      FROM tenant.tenant_settings
      WHERE tenant_id = $1
        AND setting_key = $2
      `,
      [TENANT_A, ROLLBACK_KEY]
    )
  );
  assert.equal(rolledBack.rowCount, 0);
}

async function assertTenantSettingsRls(pool) {
  await assertTenantACanInsertOwnRow(pool);
  await insertTenantSetting(pool, TENANT_B, SELECT_KEY, { owner: "B", action: "insert" });

  await assertMissingContextReturnsNoRows(pool);
  await assertTenantACannotInsertTenantBRow(pool);
  await assertTenantACanSelectOwnRow(pool);
  await assertTenantACannotSelectTenantBRow(pool);
  await assertTenantACanUpdateOwnRow(pool);
  await assertTenantACannotUpdateTenantBRow(pool);
  await assertTenantACannotReassignTenantId(pool);
  await assertTenantACanDeleteOwnRow(pool);
  await assertTenantACannotDeleteTenantBRow(pool);
  await assertContextDisappearsAfterCommit(pool);
  await assertContextDisappearsAfterRollback(pool);
  await assertPooledConnectionReuseIsSafe(pool);
  await assertSqlFailureRollsBackAndDoesNotLeak(pool);
}

async function cleanup(pool) {
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await withTenantTransaction(pool, tenantId, (client) =>
      client.query(
        `
        DELETE FROM tenant.tenant_settings
        WHERE tenant_id = $1
          AND setting_key LIKE $2
        `,
        [tenantId, `${KEY_PREFIX}%`]
      )
    ).catch(() => undefined);
  }

  await pool.query(
    `
    DELETE FROM kernel.tenants
    WHERE tenant_id = ANY($1::uuid[])
    `,
    [[TENANT_A, TENANT_B]]
  ).catch(() => undefined);
}

const TESTED_CASES = Object.freeze([
  "1. Missing tenant context returns no tenant_settings rows.",
  "2. Tenant A can insert a tenant A row.",
  "3. Tenant A cannot insert a tenant B row.",
  "4. Tenant A can select its own row.",
  "5. Tenant A cannot select tenant B's row.",
  "6. Tenant A can update its own row.",
  "7. Tenant A cannot update tenant B's row.",
  "8. Tenant A cannot change its own row's tenant_id to tenant B.",
  "9. Tenant A can delete its own row.",
  "10. Tenant A cannot delete tenant B's row.",
  "11. Context disappears after COMMIT.",
  "12. Context disappears after ROLLBACK.",
  "13. A pooled connection reused after tenant A does not expose A's context.",
  "14. The same reused connection can safely establish tenant B context afterward.",
  "15. FORCE RLS constrains the tested table owner/application role.",
  "16. Callback or SQL failure rolls back changes and does not leak tenant context.",
]);

async function main() {
  const database = requireDisposableLocalDatabaseUrl();
  const pool = new Pool({ connectionString: database.connectionString, max: 1 });
  let primaryError = null;

  try {
    const migrationSummary = await applyCurrentMigrations(pool);
    const role = await assertRoleSafety(pool, database);
    const rls = await assertRlsMetadata(pool);
    await upsertTenants(pool);
    await assertTenantSettingsRls(pool);

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        role,
        rls,
        migrationSummary,
        tested: TESTED_CASES,
      }, null, 2)}\n`
    );
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await cleanup(pool);
    } catch (cleanupError) {
      if (!primaryError) {
        throw cleanupError;
      }
      primaryError.cleanup_error = cleanupError.message;
    } finally {
      await pool.end();
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
  process.exit(1);
});
