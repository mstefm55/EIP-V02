import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  here,
  "../../../db/migrations/v2_0060_connection_capability_truth_gate.sql"
);
const source = fs.readFileSync(migrationPath, "utf8");

test("unimplemented inbound OAuth2 JWT mode is removed from selectable metadata", () => {
  assert.match(source, /dl\.code = 'CONNECTION_VERIFICATION_MODE'/);
  assert.match(source, /dv\.code = 'oauth2_jwt'/);
  assert.match(source, /SET is_active = false/);
  assert.match(source, /remove_connection_field\(tree, 'jwt_config'\)/);
  assert.match(source, /jsonb_path_exists\(surface_tree, '\$\.\*\* \? \(@\.key == "jwt_config"\)'\)/);
});

test("implemented provider verifier remains available after truth cleanup", () => {
  assert.match(source, /@\.key == "provider_verifier" && @\.advanced == true/);
});
