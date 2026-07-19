import assert from "node:assert/strict";
import test from "node:test";

import {
  redactConnectionSecrets,
  resolveDbConfig,
} from "../scripts/migrationDbConfig.mjs";

test("migration config prefers DATABASE_URL and does not merge discrete host values", () => {
  const url = "postgresql://railway_user:super-secret@railway.internal:5432/eip";
  const config = resolveDbConfig({
    DATABASE_URL: url,
    DATABASE_HOST: "ignored-host",
    DATABASE_SSL: "true",
  });

  assert.equal(config.connectionString, url);
  assert.equal(config.host, undefined);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("migration config SSL allow-invalid-certs disables certificate rejection", () => {
  const config = resolveDbConfig({
    DATABASE_URL: "postgresql://user:password@example.internal:5432/eip",
    DATABASE_SSL: "true",
    DATABASE_SSL_ALLOW_INVALID_CERTS: "true",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

test("migration config supports DB_SSL fallback", () => {
  const config = resolveDbConfig({
    DATABASE_URL: "postgresql://user:password@example.internal:5432/eip",
    DB_SSL: "true",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("migration config preserves discrete PG variable fallback", () => {
  const config = resolveDbConfig({
    PGHOST: "postgres.internal",
    PGPORT: "6543",
    PGUSER: "pg-user",
    PGPASSWORD: "pg-secret",
    PGDATABASE: "eip_v2",
    DATABASE_SSL: "true",
    DATABASE_SSL_ALLOW_INVALID_CERTS: "true",
  });

  assert.deepEqual(config, {
    host: "postgres.internal",
    port: 6543,
    user: "pg-user",
    password: "pg-secret",
    database: "eip_v2",
    ssl: { rejectUnauthorized: false },
  });
});

test("migration config fails closed in production without DATABASE_URL or explicit host", () => {
  assert.throws(
    () => resolveDbConfig({
      NODE_ENV: "production",
      DATABASE_PASSWORD: "do-not-leak",
    }),
    /DATABASE_URL or an explicit database host/
  );
});

test("migration config keeps localhost fallback outside production", () => {
  const config = resolveDbConfig({
    NODE_ENV: "development",
  });

  assert.equal(config.host, "localhost");
  assert.equal(config.database, "eip_V2");
  assert.equal(config.ssl, false);
});

test("migration error redaction removes connection strings and passwords", () => {
  const url = "postgresql://railway_user:super-secret@railway.internal:5432/eip";
  const password = "super-secret";
  const output = redactConnectionSecrets(
    `Could not connect to ${url} with ${password}`,
    {
      DATABASE_URL: url,
      DATABASE_PASSWORD: password,
    }
  );

  assert.equal(output.includes(url), false);
  assert.equal(output.includes(password), false);
  assert.equal(output, "Could not connect to [redacted] with [redacted]");
});
