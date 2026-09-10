import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeStepEditorField,
  normalizeStepEditorFields,
  patchRecordFromStepDraft,
  resolveStepEditorCreatePreview,
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

test("generic create preview reproduces the V1 Connection code slug protocol", () => {
  const field = normalizeStepEditorField({
    key: "connection_code",
    path: "identity.connection_code",
    label: "Connection code",
    read_only: true,
    create_preview: {
      source_key: "connection_name",
      transform: "slug",
      fallback: "conn",
      min_length: 3,
      short_suffix: "-conn",
      max_length: 64,
    },
  });

  assert.deepEqual(field.create_preview, {
    source_key: "connection_name",
    transform: "slug",
    fallback: "conn",
    min_length: 3,
    short_suffix: "-conn",
    max_length: 64,
  });
  assert.equal(resolveStepEditorCreatePreview(field, { connection_name: "My Website" }), "my-website");
  assert.equal(resolveStepEditorCreatePreview(field, { connection_name: "  Portal / EU !!!  " }), "portal-eu");
  assert.equal(resolveStepEditorCreatePreview(field, { connection_name: "A" }), "a-conn");
  assert.equal(resolveStepEditorCreatePreview(field, { connection_name: "***" }), "conn");
  assert.equal(resolveStepEditorCreatePreview(field, { connection_name: "" }), "");
});

test("create preview remains display-only and cannot become browser code authority", () => {
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
      create_preview: {
        source_key: "connection_name",
        transform: "slug",
        fallback: "conn",
        min_length: 3,
        short_suffix: "-conn",
        max_length: 64,
      },
    },
  ]);
  const codeField = fields.find((field) => field.key === "connection_code");
  const draft = { connection_name: "Acme Portal", connection_code: "" };

  assert.equal(resolveStepEditorCreatePreview(codeField, draft), "acme-portal");
  const payload = patchRecordFromStepDraft({}, draft, fields, { isCreate: true });
  assert.deepEqual(payload, { identity: { connection_name: "Acme Portal" } });
});

test("activation fields can be hidden only during creation", () => {
  const field = normalizeStepEditorField({
    key: "is_enabled",
    path: "identity.is_enabled",
    label: "Enabled",
    type: "checkbox",
    default_value: false,
    hide_on_create: true,
  });

  assert.equal(field.type, "checkbox");
  assert.equal(field.default_value, false);
  assert.equal(field.hide_on_create, true);
  assert.equal(field.disabled_on_create, false);
});

test("hide-on-create fields are excluded from create validation and payload patching", () => {
  const fields = normalizeStepEditorFields([
    {
      key: "connection_name",
      path: "identity.connection_name",
      label: "Connection name",
      required: true,
    },
    {
      key: "activation_gate",
      path: "identity.activation_gate",
      label: "Activation gate",
      required: true,
      hide_on_create: true,
    },
  ]);

  assert.deepEqual(
    validateStepEditorDraft(
      { connection_name: "Acme Portal", activation_gate: "" },
      fields,
      { isCreate: true }
    ),
    []
  );
  assert.deepEqual(
    validateStepEditorDraft(
      { connection_name: "Acme Portal", activation_gate: "" },
      fields
    ),
    [{ key: "activation_gate", message: "Activation gate is required." }]
  );

  const payload = patchRecordFromStepDraft(
    {},
    { connection_name: "Acme Portal", activation_gate: "operator-value" },
    fields,
    { isCreate: true }
  );
  assert.equal(payload.identity.connection_name, "Acme Portal");
  assert.equal(Object.prototype.hasOwnProperty.call(payload.identity, "activation_gate"), false);
});
