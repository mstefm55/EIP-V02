import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStepEditorDraft,
  getSafePath,
  normalizeStepEditorField,
  normalizeStepEditorFields,
  patchRecordFromStepDraft,
  setSafePath,
  validateStepEditorDraft,
} from "../src/components/primitives/contractStepEditorModel.js";

test("normalizes bounded metadata-driven fields", () => {
  const fields = normalizeStepEditorFields([
    { key: "name", path: "identity.name", label: "Name", required: true },
    { key: "mode", path: "security.mode", type: "select", options: ["a", "b"] },
    { key: "secret", path: "security.secret", type: "password", advanced: true, omit_empty: true },
    { key: "allowlist", path: "security.allowlist", type: "string_list", advanced: true },
    { key: "mapping", path: "routing.mapping", type: "json_object", advanced: true },
    { key: "__proto__", path: "unsafe.value" },
    { key: "name", path: "duplicate.value" },
  ]);

  assert.equal(fields.length, 5);
  assert.equal(fields[0].path, "identity.name");
  assert.deepEqual(fields[1].options, [
    { value: "a", label: "a" },
    { value: "b", label: "b" },
  ]);
  assert.equal(fields[2].advanced, true);
  assert.equal(fields[3].type, "string_list");
  assert.equal(fields[4].type, "json_object");
});

test("safe nested path helpers preserve unrelated metadata", () => {
  const original = {
    id: "record-1",
    identity: { name: "Before", code: "A" },
    attrs: { untouched: true },
  };
  const patched = setSafePath(original, "identity.name", "After");

  assert.equal(getSafePath(patched, "identity.name"), "After");
  assert.equal(getSafePath(patched, "identity.code"), "A");
  assert.deepEqual(patched.attrs, { untouched: true });
  assert.equal(original.identity.name, "Before");
});

test("unsafe object paths fail closed", () => {
  assert.throws(
    () => setSafePath({}, "__proto__.polluted", true),
    /UI_STEP_EDITOR_PATH_INVALID/
  );
  assert.equal(normalizeStepEditorField({ key: "safe", path: "constructor.value" }), null);
});

test("password fields are always blank when projecting server records", () => {
  const fields = normalizeStepEditorFields([
    { key: "secret", path: "security.secret", type: "password" },
  ]);
  const draft = buildStepEditorDraft({ security: { secret: "must-not-render" } }, fields);
  assert.equal(draft.secret, "");
});

test("patching a step draft changes only configured field paths", () => {
  const fields = normalizeStepEditorFields([
    { key: "name", path: "identity.name" },
    { key: "enabled", path: "identity.enabled", type: "checkbox" },
    { key: "timeout", path: "reliability.timeout_ms", type: "number" },
  ]);
  const original = {
    identity: { name: "Before", enabled: false, code: "UNCHANGED" },
    reliability: { timeout_ms: 1000, retries: 2 },
    attrs: { preserved: "yes" },
  };

  const patched = patchRecordFromStepDraft(
    original,
    { name: "After", enabled: true, timeout: 2500 },
    fields
  );

  assert.equal(patched.identity.name, "After");
  assert.equal(patched.identity.enabled, true);
  assert.equal(patched.identity.code, "UNCHANGED");
  assert.equal(patched.reliability.timeout_ms, 2500);
  assert.equal(patched.reliability.retries, 2);
  assert.equal(patched.attrs.preserved, "yes");
});

test("string-list fields round-trip arrays without frontend business parsing", () => {
  const fields = normalizeStepEditorFields([
    { key: "origins", path: "security.origins", type: "string_list" },
  ]);
  const draft = buildStepEditorDraft(
    { security: { origins: ["https://a.example", "https://b.example"] } },
    fields
  );
  assert.equal(draft.origins, "https://a.example\nhttps://b.example");

  const patched = patchRecordFromStepDraft(
    { security: { preserved: true } },
    { origins: "https://a.example\nhttps://b.example, https://a.example" },
    fields
  );
  assert.deepEqual(patched.security.origins, ["https://a.example", "https://b.example"]);
  assert.equal(patched.security.preserved, true);
});

test("json-object fields project formatted JSON and reject invalid/non-object values", () => {
  const fields = normalizeStepEditorFields([
    { key: "mapping", path: "routing.mapping", type: "json_object", label: "Mapping" },
  ]);
  const draft = buildStepEditorDraft({ routing: { mapping: { mode: "safe", version: 1 } } }, fields);
  assert.match(draft.mapping, /"mode": "safe"/);

  assert.deepEqual(validateStepEditorDraft({ mapping: "{bad" }, fields), [
    { key: "mapping", message: "Mapping must be a JSON object." },
  ]);
  assert.deepEqual(validateStepEditorDraft({ mapping: "[]" }, fields), [
    { key: "mapping", message: "Mapping must be a JSON object." },
  ]);
  assert.deepEqual(validateStepEditorDraft({ mapping: "{\"mode\":\"safe\"}" }, fields), []);

  const patched = patchRecordFromStepDraft(
    { routing: { preserved: true } },
    { mapping: "{\"mode\":\"safe\",\"version\":2}" },
    fields
  );
  assert.deepEqual(patched.routing.mapping, { mode: "safe", version: 2 });
  assert.equal(patched.routing.preserved, true);
});

test("required validation catches blank fields while allowing optional fields", () => {
  const fields = normalizeStepEditorFields([
    { key: "name", path: "identity.name", label: "Connection name", required: true },
    { key: "notes", path: "attrs.notes", label: "Notes" },
  ]);

  assert.deepEqual(validateStepEditorDraft({ name: "", notes: "" }, fields), [
    { key: "name", message: "Connection name is required." },
  ]);
  assert.deepEqual(validateStepEditorDraft({ name: "Configured", notes: "" }, fields), []);
});

test("omit-empty write-only fields do not overwrite preserved secret state", () => {
  const fields = normalizeStepEditorFields([
    { key: "secret", path: "security.secret", type: "password", omit_empty: true },
  ]);
  const base = {
    security: {
      secret_set: true,
      secret_ref: "vault://connection/secret",
    },
  };
  const patched = patchRecordFromStepDraft(base, { secret: "" }, fields);

  assert.equal(patched.security.secret_set, true);
  assert.equal(patched.security.secret_ref, "vault://connection/secret");
  assert.equal(Object.prototype.hasOwnProperty.call(patched.security, "secret"), false);
});
