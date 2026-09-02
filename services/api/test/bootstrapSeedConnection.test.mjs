import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPostgresUrlToEnv,
  resolveConnectionUrl,
} from "../scripts/bootstrap_v2_auth_seed_connection.mjs";

test("Railway public URL is preferred over private DATABASE_URL for local bootstrap", () => {
  const env = {
    DATABASE_URL: "postgresql://private_user:private_pw@postgres.railway.internal:5432/railway",
    DATABASE_PUBLIC_URL: "postgresql://public_user:public_pw@roundhouse.proxy.rlwy.net:12345/railway",
  };

  assert.equal(resolveConnectionUrl(env), env.DATABASE_PUBLIC_URL);
});

test("explicit bootstrap URL overrides Railway defaults", () => {
  const env = {
    V2_BOOTSTRAP_DATABASE_URL: "postgresql://seed_user:seed_pw@seed.example:6543/eip",
    DATABASE_PUBLIC_URL: "postgresql://public_user:public_pw@public.example:12345/railway",
    DATABASE_URL: "postgresql://private_user:private_pw@private.example:5432/railway",
  };

  assert.equal(resolveConnectionUrl(env), env.V2_BOOTSTRAP_DATABASE_URL);
});

test("connection URL is decomposed into pg variables without exposing it to legacy seed", () => {
  const env = {};
  const applied = applyPostgresUrlToEnv(
    "postgresql://seed%40user:p%40ss%3Aword@roundhouse.proxy.rlwy.net:23456/eip_V2",
    env
  );

  assert.equal(applied, true);
  assert.deepEqual(env, {
    PGHOST: "roundhouse.proxy.rlwy.net",
    PGPORT: "23456",
    PGUSER: "seed@user",
    PGPASSWORD: "p@ss:word",
    PGDATABASE: "eip_V2",
  });
});

test("invalid database URL fails closed", () => {
  assert.throws(
    () => applyPostgresUrlToEnv("https://example.com/database", {}),
    /must use postgres:\/\/ or postgresql:\/\//
  );
});
