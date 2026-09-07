import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");

function read(relativePath) {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), "utf8");
}

function parseSurfaceTree(migrationSource) {
  const match = migrationSource.match(/SET tree = \$json\$\s*([\s\S]*?)\s*\$json\$::jsonb/);
  assert.ok(match, "connection surface migration must contain a JSON ui_surface tree");
  return JSON.parse(match[1]);
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child, visit);
  }
}

const migration = read("db/migrations/v2_0043_connection_management_surface_v1.sql");
const tree = parseSurfaceTree(migration);

function nodesOfType(type) {
  const matches = [];
  walk(tree, (node) => {
    if (node.type === type) matches.push(node);
  });
  return matches;
}

function collectContracts(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (!Array.isArray(value) && typeof value.endpoint === "string") {
    output.push({
      method: String(value.method || "GET").toUpperCase(),
      endpoint: value.endpoint,
    });
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectContracts(entry, output);
    return output;
  }
  for (const entry of Object.values(value)) collectContracts(entry, output);
  return output;
}

function collectPermissionTokens(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (!Array.isArray(value) && Array.isArray(value.permissions_any)) {
    output.push(...value.permissions_any);
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectPermissionTokens(entry, output);
    return output;
  }
  for (const entry of Object.values(value)) collectPermissionTokens(entry, output);
  return output;
}

test("connection surface composes the canonical seven-step journey from generic primitives", () => {
  assert.equal(tree.type, "SurfaceRoot");
  assert.equal(tree.props?.surface_kind, "connections");
  assert.equal(tree.props?.composition, "connection_setup_v1");

  const navigators = nodesOfType("FlowStepNavigator");
  assert.equal(navigators.length, 1);
  assert.equal(navigators[0].props?.selection_target, "connection_setup_step");
  assert.equal(navigators[0].props?.reset_on_selection_target, "connection");
  assert.deepEqual(
    navigators[0].props?.steps?.map((step) => step.id),
    ["identity", "endpoint", "security", "reliability", "routing", "health", "audit"]
  );

  assert.equal(nodesOfType("FlowStepPanel").length, 7);
  assert.ok(nodesOfType("ContractTablePanel").length >= 1);
  assert.ok(nodesOfType("ContractFlowStepEditor").length >= 6);
  assert.ok(nodesOfType("ContractActionPanel").length >= 3);
  assert.ok(nodesOfType("SelectionDetailPanel").length >= 1);
  assert.equal(nodesOfType("ContractRecordEditor").length, 0);
});

test("connection surface binds only to governed owner-admin connection contracts", () => {
  const contracts = collectContracts(tree);
  assert.ok(contracts.length > 0);

  for (const contract of contracts) {
    assert.match(contract.endpoint, /^\/api\/eip\/owner-admin\/connections(?:\/|$)/);
    assert.doesNotMatch(contract.endpoint, /owner-admin\/modules|owner_admin\./i);
  }

  const keys = new Set(contracts.map((contract) => `${contract.method} ${contract.endpoint}`));
  for (const required of [
    "GET /api/eip/owner-admin/connections",
    "POST /api/eip/owner-admin/connections",
    "GET /api/eip/owner-admin/connections/taxonomy",
    "GET /api/eip/owner-admin/connections/:code",
    "PATCH /api/eip/owner-admin/connections/:code",
    "POST /api/eip/owner-admin/connections/:code/test",
    "POST /api/eip/owner-admin/connections/:code/secrets/:kind/rotate",
    "POST /api/eip/owner-admin/connections/:code/secrets/:kind/revoke",
  ]) {
    assert.ok(keys.has(required), `missing governed connection contract: ${required}`);
  }
});

test("connection surface uses dedicated permission boundaries", () => {
  const permissions = Array.from(new Set(collectPermissionTokens(tree)));
  assert.ok(permissions.length > 0);
  for (const permission of permissions) {
    assert.match(permission, /^OWNER_ADMIN_CONNECTION_/);
  }
  assert.ok(permissions.includes("OWNER_ADMIN_CONNECTION_WRITE"));
  assert.ok(permissions.includes("OWNER_ADMIN_CONNECTION_TEST"));
  assert.ok(permissions.includes("OWNER_ADMIN_CONNECTION_SECRET_MANAGE"));
});

test("credential entry is write-only and lifecycle actions stay dedicated", () => {
  const actionPanels = nodesOfType("ContractActionPanel");
  const rotatePanel = actionPanels.find((panel) => panel.props?.actions?.some((action) => action.id === "rotate"));
  const revokePanel = actionPanels.find((panel) => panel.props?.actions?.some((action) => action.id === "revoke"));

  assert.ok(rotatePanel);
  assert.ok(revokePanel);

  const credentialValue = rotatePanel.props.fields.find((field) => field.key === "value");
  assert.equal(credentialValue?.type, "password");
  assert.equal(credentialValue?.omit_empty, true);
  assert.equal(credentialValue?.path, "value");

  assert.doesNotMatch(migration, /"path"\s*:\s*"[^\"]*(?:secret_ref|password_ref|token_ref|client_secret_ref)[^\"]*"/i);
  assert.doesNotMatch(migration, /"default_value"\s*:\s*"[^\"]*(?:secret|token|password)/i);
});

test("migration 43 remains a pre-release composition and does not enable navigation", () => {
  assert.match(migration, /'\{\"enabled\":false,/);
  assert.match(migration, /Pre-release validation/);
  assert.doesNotMatch(migration, /'\{\"enabled\":true,/);
});
