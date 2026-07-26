import assert from "node:assert/strict";
import test from "node:test";

import {
  BASELINE_REQUIRED_OBJECTS,
  applyMigration,
  baselineExistingMigrations,
  buildMigrations,
  checksumSql,
  planMigrations,
  runMigrationsWithLedger,
} from "../scripts/migrationLedger.mjs";

class FakeClient {
  constructor({ ledgerRows = [], missingBaselineObjects = [], failWhenSqlIncludes = null } = {}) {
    this.ledgerRows = ledgerRows.map((row) => ({ ...row }));
    this.missingBaselineObjects = new Set(missingBaselineObjects);
    this.failWhenSqlIncludes = failWhenSqlIncludes;
    this.queries = [];
  }

  async query(sql, params = []) {
    const text = String(sql).trim();
    this.queries.push({ sql: text, params });

    if (this.failWhenSqlIncludes && text.includes(this.failWhenSqlIncludes)) {
      throw new Error("synthetic migration failure");
    }

    if (text.includes("SELECT filename, checksum")) {
      return {
        rows: this.ledgerRows.map((row) => ({ ...row })),
        rowCount: this.ledgerRows.length,
      };
    }

    if (text.includes("FROM unnest($1::text[]) AS required_object")) {
      const requiredObjects = Array.isArray(params[0]) ? params[0] : BASELINE_REQUIRED_OBJECTS;
      return {
        rows: requiredObjects.map((requiredObject) => ({
          required_object: requiredObject,
          resolved_object: this.missingBaselineObjects.has(requiredObject) ? null : requiredObject,
        })),
        rowCount: requiredObjects.length,
      };
    }

    if (text.includes("INSERT INTO eip_core.schema_migration")) {
      this.ledgerRows.push({
        filename: params[0],
        checksum: params[1],
        execution_ms: params[2],
      });
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }

  queryTexts() {
    return this.queries.map((query) => query.sql);
  }
}

function migration(filename, sql = "-- noop") {
  return buildMigrations([{ filename, sql }])[0];
}

test("fresh database migration planning marks all migrations pending", () => {
  const migrations = [
    migration("v2_0001_kernel_bootstrap.sql"),
    migration("v2_0002_security_memberships.sql"),
  ];

  const plan = planMigrations(migrations, []);

  assert.deepEqual(plan.pending.map((item) => item.filename), [
    "v2_0001_kernel_bootstrap.sql",
    "v2_0002_security_memberships.sql",
  ]);
  assert.deepEqual(plan.skipped, []);
});

test("previously applied migrations with matching checksum are skipped", () => {
  const sql = "-- already applied";
  const migrations = [migration("v2_0001_kernel_bootstrap.sql", sql)];

  const plan = planMigrations(migrations, [
    {
      filename: "v2_0001_kernel_bootstrap.sql",
      checksum: checksumSql(sql),
    },
  ]);

  assert.deepEqual(plan.pending, []);
  assert.deepEqual(plan.skipped.map((item) => item.filename), ["v2_0001_kernel_bootstrap.sql"]);
});

test("checksum mismatch is rejected before applying more migrations", () => {
  const migrations = [migration("v2_0001_kernel_bootstrap.sql", "-- current")];

  assert.throws(
    () => planMigrations(migrations, [
      {
        filename: "v2_0001_kernel_bootstrap.sql",
        checksum: checksumSql("-- old"),
      },
    ]),
    /checksum mismatch/
  );
});

test("empty-ledger baseline records current filenames without executing migration SQL", async () => {
  const migrations = [
    migration("v2_0001_kernel_bootstrap.sql", "SELECT 'must not run';"),
    migration("v2_0002_security_memberships.sql", "SELECT 'also must not run';"),
  ];
  const client = new FakeClient();

  const result = await baselineExistingMigrations(client, migrations, []);

  assert.equal(result.mode, "baseline");
  assert.deepEqual(result.baselined, [
    "v2_0001_kernel_bootstrap.sql",
    "v2_0002_security_memberships.sql",
  ]);
  assert.equal(client.ledgerRows.length, 2);
  assert.equal(
    client.queryTexts().some((sql) => sql.includes("must not run")),
    false
  );
});

test("baseline is rejected when expected V2 foundation objects are absent", async () => {
  const client = new FakeClient({
    missingBaselineObjects: ["eip_core.service_object"],
  });

  await assert.rejects(
    () => baselineExistingMigrations(client, [migration("v2_0001_kernel_bootstrap.sql")], []),
    /expected V2 foundation objects are missing: eip_core\.service_object/
  );
  assert.equal(client.ledgerRows.length, 0);
});

test("baseline is rejected when ledger is not empty", async () => {
  const existing = [{
    filename: "v2_0001_kernel_bootstrap.sql",
    checksum: checksumSql("-- old"),
  }];
  const client = new FakeClient({ ledgerRows: existing });

  await assert.rejects(
    () => baselineExistingMigrations(client, [migration("v2_0002_security_memberships.sql")], existing),
    /schema_migration is not empty/
  );
  assert.equal(
    client.queryTexts().some((sql) => sql.includes("FROM unnest($1::text[])")),
    false
  );
});

test("transaction failure rolls back and does not write ledger record", async () => {
  const client = new FakeClient({ failWhenSqlIncludes: "BROKEN" });

  await assert.rejects(
    () => applyMigration(client, migration("v2_0001_kernel_bootstrap.sql", "BEGIN;\nSELECT 'BROKEN';\nCOMMIT;")),
    /synthetic migration failure/
  );

  assert.deepEqual(client.queryTexts(), [
    "BEGIN",
    "SELECT 'BROKEN';",
    "ROLLBACK",
  ]);
  assert.equal(client.ledgerRows.length, 0);
});

test("migration filenames are ordered deterministically", () => {
  const migrations = buildMigrations([
    { filename: "v2_0010_macro_runtime_governance.sql", sql: "-- ten" },
    { filename: "v2_0002_security_memberships.sql", sql: "-- two" },
    { filename: "v2_0001_kernel_bootstrap.sql", sql: "-- one" },
  ]);

  assert.deepEqual(migrations.map((item) => item.filename), [
    "v2_0001_kernel_bootstrap.sql",
    "v2_0002_security_memberships.sql",
    "v2_0010_macro_runtime_governance.sql",
  ]);
});

test("runner skips previously applied migrations through the ledger", async () => {
  const sql = "-- applied";
  const migrations = [migration("v2_0001_kernel_bootstrap.sql", sql)];
  const client = new FakeClient({
    ledgerRows: [{
      filename: "v2_0001_kernel_bootstrap.sql",
      checksum: checksumSql(sql),
    }],
  });

  const result = await runMigrationsWithLedger(client, migrations);

  assert.equal(result.mode, "apply");
  assert.equal(result.migration_count, 0);
  assert.deepEqual(result.skipped, ["v2_0001_kernel_bootstrap.sql"]);
});
