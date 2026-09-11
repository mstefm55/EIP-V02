import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.resolve(here, "../../../db/migrations/v2_0062_connection_zero_pending_closure.sql"),
  "utf8"
);

test("final Connections surface cannot expose a whole-root attrs editor", () => {
  assert.match(migration, /'provider_extensions'/);
  assert.match(migration, /surface_tree::text LIKE '%\"path\":\"attrs\"%'/);
  assert.match(migration, /surface_tree::text LIKE '%\"path\": \"attrs\"%'/);
});

test("legacy fields without independent V2 runtime behavior are removed from operator metadata", () => {
  assert.match(migration, /'raw_body_required'/);
  assert.match(migration, /'auth_public_key_ref'/);
  assert.match(migration, /#- '\{inbound,raw_body_required\}'/);
  assert.match(migration, /#- '\{outbound,auth,public_key_ref\}'/);
});

test("endpoint health check offers only non-mutating methods", () => {
  assert.match(migration, /'test_request_method'/);
  assert.match(migration, /'default_value', 'HEAD'/);
  assert.match(migration, /jsonb_build_object\('value', 'HEAD', 'label', 'HEAD'\)/);
  assert.match(migration, /jsonb_build_object\('value', 'GET', 'label', 'GET'\)/);
  assert.match(migration, /Use Authenticated request test for POST, PUT, PATCH or DELETE/);
});

test("tenant authority is still excluded from the surface", () => {
  assert.match(migration, /surface_tree::text LIKE '%\"tenant_id\"%'/);
});
