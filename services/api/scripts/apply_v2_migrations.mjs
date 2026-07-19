import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

function pick(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveDbConfig() {
  return {
    host: pick(process.env.DATABASE_HOST, process.env.DB_HOST, process.env.PGHOST, "localhost"),
    port: parseInteger(pick(process.env.DATABASE_PORT, process.env.DB_PORT, process.env.PGPORT), 5432),
    user: pick(process.env.DATABASE_USER, process.env.DB_USER, process.env.PGUSER, "postgres"),
    password: pick(process.env.DATABASE_PASSWORD, process.env.DB_PASSWORD, process.env.PGPASSWORD, ""),
    database: pick(
      process.env.DATABASE_NAME,
      process.env.DB_DATABASE,
      process.env.DATABASE,
      process.env.PGDATABASE,
      process.env.V2_DATABASE_NAME,
      "eip_V2"
    ),
  };
}

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

async function main() {
  const migrationsDir = resolveMigrationsDir();
  const files = await loadMigrationFiles(migrationsDir);
  if (files.length === 0) {
    throw new Error(`No V2 migration files found in ${migrationsDir}`);
  }

  const pool = new pg.Pool(resolveDbConfig());
  const client = await pool.connect();
  const lockKey = 6_178_021;
  const applied = [];
  const skipped = [];

  function isAlreadyAppliedError(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "").toLowerCase();
    return (
      code === "42710" || // duplicate_object (for policies)
      code === "42P07" || // duplicate_table
      message.includes("already exists")
    );
  }

  try {
    await client.query("SELECT pg_advisory_lock($1)", [lockKey]);

    for (const file of files) {
      const sql = await readSql(migrationsDir, file);
      try {
        await client.query(sql);
        applied.push(file);
        process.stdout.write(`applied ${file}\n`);
      } catch (error) {
        if (isAlreadyAppliedError(error)) {
          await client.query("ROLLBACK").catch(() => undefined);
          skipped.push(file);
          process.stdout.write(`skipped ${file} (already applied)\n`);
          continue;
        }
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch(() => undefined);
    client.release();
    await pool.end();
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      migration_count: applied.length,
      skipped_count: skipped.length,
      applied,
      skipped,
    }, null, 2)}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2)}\n`);
  process.exit(1);
});
