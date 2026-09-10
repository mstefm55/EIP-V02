import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeStepEditorField,
  normalizeStepEditorFields,
  patchRecordFromStepDraft,
  validateStepEditorDraft,
} from "../src/components/primitives/contractStepEditorModel.js";

test("read-only generated fields are metadata-driven and never required from the operator", () => {
  const field = normalizeStepEditorField({
    key: "connection_code",
    path: "identity.connection_code",
    label: "Connection code",
    required: true,
    read_only: true,
    omit_empty: true,
    immutable_after_create: true,
  });

  assert.equal(field.read_only, true);
  assert.equal(field.immutable_after_create, true);
  assert.deepEqual(validateStepEditorDraft({ connection_code: "" }, [field]), []);
});

test("read-only generated fields cannot be injected into create payloads", () => {
  const fields = normalizeStepEditorFields([
    {
      key: "connection_name",
      path: "identity.connection_name",
      label: "Connection name",
      required: true,
    },
    {
      key: "connection_code",
      path: "identity.connection_code",
      label: "Connection code",
      read_only: true,
      omit_empty: true,
    },
  ]);

  const payload = patchRecordFromStepDraft(
    {},
    { connection_name: "Acme Portal", connection_code: "operator-supplied" },
    fields,
    { isCreate: true }
  );

  assert.equal(payload.identity.connection_name, "Acme Portal");
  assert.equal(Object.prototype.hasOwnProperty.call(payload.identity, "connection_code"), false);
});

test("create-only disabled metadata is retained for activation controls", () => {
  const field = normalizeStepEditorField({
    key: "is_enabled",
    path: "identity.is_enabled",
    label: "Enabled",
    type: "checkbox",
    default_value: false,
    disabled_on_create: true,
  });

  assert.equal(field.type, "checkbox");
  assert.equal(field.default_value, false);
  assert.equal(field.disabled_on_create, true);
});
