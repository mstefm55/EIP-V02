import crypto from "node:crypto";

const MIGRATION_LEDGER_TABLE = "eip_core.schema_migration";

const BASELINE_REQUIRED_OBJECTS = Object.freeze([
  "kernel.tenants",
  "security.principals",
  "security.tenant_memberships",
  "tenant.tenant_settings",
  "eip_auth.auth_identity",
  "eip_auth.auth_credential",
  "eip_auth.auth_session",
  "eip_auth.auth_identity_agent",
  "eip_auth.auth_device",
  "eip_auth.auth_otp_challenge",
  "eip_core.agent",
  "eip_core.service_object",
  "eip_core.service_object_party",
  "eip_core.dropdown_list",
  "eip_core.dropdown_value",
  "eip_core.process_def",
  "eip_core.process_binding",
  "eip_core.task_template",
  "eip_core.task",
  "eip_core.process_instance",
  "eip_core.service_object_status_event",
  "eip_core.task_status_event",
  "eip_core.ui_surface",
  "eip_core.ui_shell_profile",
  "eip_core.ui_shell_profile_revision",
  "eip_core.ui_shell_profile_event",
]);

function parseBoolean(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function checksumSql(sql) {
  return crypto.createHash("sha256").update(String(sql ?? ""), "utf8").digest("hex");
}

function sortMigrationFilenames(filenames) {
  return [...filenames].sort((a, b) => a.localeCompare(b, "en", {
    numeric: true,
    sensitivity: "base",
  }));
}

function stripOuterTransaction(sql) {
  return String(sql ?? "")
    .trim()
    .replace(/^\s*BEGIN\s*;\s*/i, "")
    .replace(/\s*COMMIT\s*;\s*$/i, "")
    .trim();
}

function buildMigrations(files) {
  const seen = new Set();
  return sortMigrationFilenames(files.map((file) => file.filename)).map((filename) => {
    if (seen.has(filename)) {
      throw new Error(`Duplicate migration filename: ${filename}`);
    }
    seen.add(filename);

    const file = files.find((candidate) => candidate.filename === filename);
    const sql = String(file?.sql ?? "");
    return {
      filename,
      sql,
      checksum: checksumSql(sql),
    };
  });
}

function planMigrations(migrations, appliedRows = []) {
  const appliedByFilename = new Map();
  for (const row of appliedRows || []) {
    appliedByFilename.set(String(row.filename), String(row.checksum));
  }

  const pending = [];
  const skipped = [];

  for (const migration of migrations) {
    const appliedChecksum = appliedByFilename.get(migration.filename);
    if (appliedChecksum === undefined) {
      pending.push(migration);
      continue;
    }

    if (appliedChecksum !== migration.checksum) {
      throw new Error(
        `Migration checksum mismatch for ${migration.filename}. Refusing to continue.`
      );
    }

    skipped.push({
      filename: migration.filename,
      checksum: migration.checksum,
    });
  }

  return { pending, skipped };
}

async function ensureMigrationLedger(client) {
  await client.query("CREATE SCHEMA IF NOT EXISTS eip_core");
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_LEDGER_TABLE} (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      execution_ms bigint
    )
  `);
  await client.query(`
    COMMENT ON TABLE ${MIGRATION_LEDGER_TABLE} IS
      'Durable V2 migration ledger. One row per applied migration file/checksum.'
  `);
  await client.query(`
    COMMENT ON COLUMN ${MIGRATION_LEDGER_TABLE}.checksum IS
      'SHA-256 checksum of the migration SQL file at the time it was applied or baselined.'
  `);
}

async function loadAppliedMigrations(client) {
  const result = await client.query(`
    SELECT filename, checksum, applied_at, execution_ms
    FROM ${MIGRATION_LEDGER_TABLE}
    ORDER BY filename ASC
  `);
  return Array.isArray(result?.rows) ? result.rows : [];
}

async function insertMigrationRecord(client, migration, executionMs) {
  await client.query(
    `
    INSERT INTO ${MIGRATION_LEDGER_TABLE} (filename, checksum, execution_ms)
    VALUES ($1, $2, $3)
    `,
    [migration.filename, migration.checksum, executionMs]
  );
}

async function applyMigration(client, migration) {
  const executableSql = stripOuterTransaction(migration.sql);
  const startedAt = Date.now();

  await client.query("BEGIN");
  try {
    if (executableSql) {
      await client.query(executableSql);
    }
    const executionMs = Date.now() - startedAt;
    await insertMigrationRecord(client, migration, executionMs);
    await client.query("COMMIT");
    return {
      filename: migration.filename,
      checksum: migration.checksum,
      execution_ms: executionMs,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function verifyBaselineFoundation(client, requiredObjects = BASELINE_REQUIRED_OBJECTS) {
  const result = await client.query(
    `
    SELECT required_object, to_regclass(required_object)::text AS resolved_object
    FROM unnest($1::text[]) AS required_object
    ORDER BY required_object
    `,
    [requiredObjects]
  );
  const present = new Set(
    (Array.isArray(result?.rows) ? result.rows : [])
      .filter((row) => row.resolved_object)
      .map((row) => String(row.required_object))
  );
  const missing = requiredObjects.filter((objectName) => !present.has(objectName));

  return {
    ok: missing.length === 0,
    required: [...requiredObjects],
    missing,
  };
}

async function baselineExistingMigrations(client, migrations, appliedRows = []) {
  if ((appliedRows || []).length > 0) {
    throw new Error(
      "MIGRATION_BASELINE_EXISTING refused because eip_core.schema_migration is not empty"
    );
  }

  const foundation = await verifyBaselineFoundation(client);
  if (!foundation.ok) {
    throw new Error(
      `MIGRATION_BASELINE_EXISTING refused because expected V2 foundation objects are missing: ${foundation.missing.join(", ")}`
    );
  }

  await client.query("BEGIN");
  try {
    for (const migration of migrations) {
      await insertMigrationRecord(client, migration, 0);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  return {
    mode: "baseline",
    baselined_count: migrations.length,
    baselined: migrations.map((migration) => migration.filename),
    verified_objects: foundation.required,
  };
}

async function runMigrationsWithLedger(client, migrations, options = {}) {
  await ensureMigrationLedger(client);
  const appliedRows = await loadAppliedMigrations(client);
  const baselineExisting = parseBoolean(options.baselineExisting, false);

  if (baselineExisting) {
    return baselineExistingMigrations(client, migrations, appliedRows);
  }

  const plan = planMigrations(migrations, appliedRows);
  const applied = [];

  for (const migration of plan.pending) {
    const result = await applyMigration(client, migration);
    applied.push(result);
  }

  return {
    mode: "apply",
    migration_count: applied.length,
    skipped_count: plan.skipped.length,
    applied: applied.map((migration) => migration.filename),
    skipped: plan.skipped.map((migration) => migration.filename),
  };
}

export {
  BASELINE_REQUIRED_OBJECTS,
  MIGRATION_LEDGER_TABLE,
  applyMigration,
  baselineExistingMigrations,
  buildMigrations,
  checksumSql,
  ensureMigrationLedger,
  loadAppliedMigrations,
  parseBoolean,
  planMigrations,
  runMigrationsWithLedger,
  sortMigrationFilenames,
  stripOuterTransaction,
  verifyBaselineFoundation,
};
