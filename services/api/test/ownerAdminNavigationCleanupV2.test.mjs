import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "../..");

function read(relativePath) {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), "utf8");
}

const migrationPath = "db/migrations/v2_0065_owner_admin_navigation_cleanup.sql";

test("superseded Integrations nav is retired only after governed Connections exists", () => {
  const migration = read(migrationPath);

  assert.match(migration, /code = 'owner_connections'/);
  assert.match(migration, /code = 'owner_integrations'/);
  assert.match(migration, /Superseded by Connections/);
  assert.match(migration, /is_active = false/);
  assert.match(migration, /must not disable owner_connections/);
});

test("navigation cleanup does not create a second integration engine or schema", () => {
  const migration = read(migrationPath);

  assert.doesNotMatch(migration, /CREATE TABLE|CREATE SCHEMA|CREATE TYPE/i);
  assert.doesNotMatch(migration, /INSERT INTO\s+eip_core\.ui_surface/i);
  assert.doesNotMatch(migration, /provider|gateway profile|credential/i);
});

test("surface catalogue naturally excludes inactive retired surfaces", () => {
  const route = read("services/api/src/routes/ui_surface.js");

  assert.match(route, /WHERE is_active = true/);
  assert.match(route, /is_published = true/);
});
