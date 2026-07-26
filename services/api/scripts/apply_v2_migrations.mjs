import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { redactConnectionSecrets, resolveDbConfig } from "./migrationDbConfig.mjs";
import { buildMigrations, runMigrationsWithLedger } from "./migrationLedger.mjs";

function resolveMigrationsDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../db/migrations");
}

async function loadMigrationFiles(migrationsDir) {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^v2_\d+.*\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function readSql(migrationsDir, filename) {
  return fs.readFile(path.join(migrationsDir, filename), "utf8");
}

async function loadMigrations(migrationsDir) {
  const filenames = await loadMigrationFiles(migrationsDir);
  return buildMigrations(
    await Promise.all(
      filenames.map(async (filename) => ({
        filename,
        sql: await readSql(migrationsDir, filename),
      }))
    )
  );
}

async function main() {
  const migrationsDir = resolveMigrationsDir();
  const migrations = await loadMigrations(migrationsDir);
  if (migrations.length === 0) {
    throw new Error(`No V2 migration files found in ${migrationsDir}`);
  }

  const pool = new pg.Pool(resolveDbConfig());
  const client = await pool.connect();
  const lockKey = 6_178_021;
  const resultSummary = {};

  try {
    await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
    const summary = await runMigrationsWithLedger(client, migrations, {
      baselineExisting: process.env.MIGRATION_BASELINE_EXISTING,
    });
    Object.assign(resultSummary, summary);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch(() => undefined);
    client.release();
    await pool.end();
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      ...resultSummary,
    }, null, 2)}\n`
  );
}

main().catch((error) => {
  const safeMessage = redactConnectionSecrets(error?.message || String(error));
  process.stderr.write(`${JSON.stringify({ ok: false, error: safeMessage }, null, 2)}\n`);
  process.exit(1);
});
