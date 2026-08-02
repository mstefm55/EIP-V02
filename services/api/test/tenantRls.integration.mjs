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
const TENANT_A = "44444444-4444-4444-8444-444444444444";
const TENANT_B = "55555555-5555-4555-8555-555555555555";
const SETTING_KEY = `WAVE_2A_RLS_TEST_${Date.now()}`;

function requireDisposableLocalDatabaseUrl() {
  const connectionString = process.env.EIP_RLS_TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "EIP_RLS_TEST_DATABASE_URL is required for the tenant RLS integration suite. Use a disposable local PostgreSQL database."
    );
  }

  const url = new URL(connectionString);
  const host = url.hostname.toLowerCase();
  const allowRemote = String(process.env.EIP_RLS_TEST_ALLOW_REMOTE || "").toLowerCase() === "true";
  if (!allowRemote && !["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(
      "Refusing to run tenant RLS integration suite against a non-local database without EIP_RLS_TEST_ALLOW_REMOTE=true."
    );
  }

  return connectionString;
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

async function upsertTenants(pool) {
  await pool.query(
    `
    INSERT INTO kernel.tenants (tenant_id, tenant_code, tenant_name)
    VALUES
      ($1, 'wave-2a-tenant-a', 'Wave 2A Tenant A'),
      ($2, 'wave-2a-tenant-b', 'Wave 2A Tenant B')
    ON CONFLICT (tenant_id) DO UPDATE
      SET tenant_name = excluded.tenant_name,
          updated_at = now()
    `,
    [TENANT_A, TENANT_B]
  );
}

async function seedTenantSettings(pool) {
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
      VALUES (
        $3,
        $1,
        $2,
        '{"tenant":"A"}'::jsonb,
        'active'
      )
      ON CONFLICT (tenant_id, setting_key) DO UPDATE
        SET setting_value = excluded.setting_value,
            setting_status = excluded.setting_status,
            updated_at = now()
      `,
      [TENANT_A, SETTING_KEY, randomUUID()]
    );
  });

  await withTenantTransaction(pool, TENANT_B, async (client) => {
    await client.query(
      `
      INSERT INTO tenant.tenant_settings (
        tenant_setting_id,
        tenant_id,
        setting_key,
        setting_value,
        setting_status
      )
      VALUES (
        $3,
        $1,
        $2,
        '{"tenant":"B"}'::jsonb,
        'active'
      )
      ON CONFLICT (tenant_id, setting_key) DO UPDATE
        SET setting_value = excluded.setting_value,
            setting_status = excluded.setting_status,
            updated_at = now()
      `,
      [TENANT_B, SETTING_KEY, randomUUID()]
    );
  });
}

async function assertTenantSettingsRls(pool) {
  const missingContext = await pool.query(
    "SELECT tenant_id, setting_value FROM tenant.tenant_settings WHERE setting_key = $1 ORDER BY tenant_id",
    [SETTING_KEY]
  );
  assert.equal(missingContext.rowCount, 0);

  const tenantA = await withTenantTransaction(pool, TENANT_A, (client) =>
    client.query(
      "SELECT tenant_id, setting_value FROM tenant.tenant_settings WHERE setting_key = $1 ORDER BY tenant_id",
      [SETTING_KEY]
    )
  );
  assert.deepEqual(tenantA.rows.map((row) => row.tenant_id), [TENANT_A]);
  assert.deepEqual(tenantA.rows[0].setting_value, { tenant: "A" });

  const crossTenant = await withTenantTransaction(pool, TENANT_B, (client) =>
    client.query(
      "SELECT tenant_id, setting_value FROM tenant.tenant_settings WHERE tenant_id = $1 AND setting_key = $2",
      [TENANT_A, SETTING_KEY]
    )
  );
  assert.equal(crossTenant.rowCount, 0);

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
        VALUES (
          $3,
          $1,
          $2,
          '{"tenant":"mismatch"}'::jsonb,
          'active'
        )
        `,
        [TENANT_B, `${SETTING_KEY}_MISMATCH`, randomUUID()]
      )
    ),
    /row-level security|violates row-level security|new row violates/
  );
}

async function main() {
  const connectionString = requireDisposableLocalDatabaseUrl();
  const pool = new Pool({ connectionString });

  try {
    const migrationSummary = await applyCurrentMigrations(pool);
    await upsertTenants(pool);
    await seedTenantSettings(pool);
    await assertTenantSettingsRls(pool);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        migrationSummary,
        tested: [
          "missing tenant context exposes no tenant_settings rows",
          "same-tenant select succeeds",
          "cross-tenant select returns no rows",
          "mismatched tenant insert is rejected",
        ],
      }, null, 2)}\n`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
  process.exit(1);
});
