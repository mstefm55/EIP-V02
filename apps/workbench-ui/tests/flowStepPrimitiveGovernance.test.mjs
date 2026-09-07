import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../src/", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

test("flow step primitives are allowlisted in the generic UI registry", async () => {
  const registry = await read("engine/registry.jsx");
  assert.match(registry, /FlowStepNavigator/);
  assert.match(registry, /flow_step_navigator_v1/);
  assert.match(registry, /FlowStepPanel/);
  assert.match(registry, /flow_step_panel_v1/);
  assert.match(registry, /ContractFlowStepEditor/);
  assert.match(registry, /contract_flow_step_editor_v1/);
  assert.match(registry, /ContractActionPanel/);
  assert.match(registry, /contract_action_panel_v1/);
});

test("flow step primitives remain domain neutral", async () => {
  const sources = [
    await read("components/primitives/FlowStepNavigator.jsx"),
    await read("components/primitives/FlowStepPanel.jsx"),
    await read("components/primitives/flowStepModel.js"),
    await read("components/primitives/ContractFlowStepEditor.jsx"),
    await read("components/primitives/ContractActionPanel.jsx"),
    await read("components/primitives/contractStepEditorModel.js"),
  ].join("\n");

  const forbiddenBusinessTokens = [
    "paypal",
    "checkout.com",
    "checkout_com",
    "sales_order",
    "production_process",
    "connection_kind",
    "gateway/connections",
  ];

  for (const token of forbiddenBusinessTokens) {
    assert.equal(
      sources.toLowerCase().includes(token.toLowerCase()),
      false,
      `generic flow primitive must not own business token: ${token}`
    );
  }
});

test("flow step navigator delegates selection through the generic target model", async () => {
  const navigator = await read("components/primitives/FlowStepNavigator.jsx");
  const panel = await read("components/primitives/FlowStepPanel.jsx");

  assert.match(navigator, /selection_target/);
  assert.match(navigator, /selectTarget/);
  assert.match(navigator, /getTarget/);
  assert.match(panel, /selection_target/);
  assert.match(panel, /getTarget/);
});

test("contract flow step editor uses governed contracts rather than embedded endpoints", async () => {
  const editor = await read("components/primitives/ContractFlowStepEditor.jsx");

  assert.match(editor, /resolveContract/);
  assert.match(editor, /detail_contract/);
  assert.match(editor, /update_contract/);
  assert.match(editor, /record_selection_target/);
  assert.equal(/\/api\/eip\//.test(editor), false);
  assert.equal(/fetch\s*\(/.test(editor), false);
});

test("contract action panel keeps action endpoints and payloads metadata-owned", async () => {
  const panel = await read("components/primitives/ContractActionPanel.jsx");

  assert.match(panel, /resolveContract/);
  assert.match(panel, /path_params/);
  assert.match(panel, /resolveValue/);
  assert.match(panel, /record_selection_target/);
  assert.match(panel, /permissions_any/);
  assert.equal(/\/api\/eip\//.test(panel), false);
  assert.equal(/fetch\s*\(/.test(panel), false);
});
