import assert from "node:assert/strict";
import test from "node:test";

import {
  PROCESS_LIFECYCLE,
  assertProcessDraftMutable,
  buildProcessArchivedAttrs,
  buildProcessDraftAttrs,
  buildProcessPublishedAttrs,
  isProcessArchived,
  isProcessDraft,
  isProcessPublished,
  processRuntimeEligibility,
  resolveNextProcessVersion,
  resolveProcessLifecycle,
} from "../src/services/process/processDefinitionLifecycle.js";

test("legacy is_published metadata resolves to published lifecycle", () => {
  assert.equal(resolveProcessLifecycle({ is_published: true }), PROCESS_LIFECYCLE.PUBLISHED);
  assert.equal(isProcessPublished({ is_published: true }), true);
  assert.equal(isProcessDraft({ is_published: true }), false);
});

test("explicit lifecycle status takes precedence over legacy compatibility flags", () => {
  assert.equal(
    resolveProcessLifecycle({ lifecycle_status: "archived", is_published: true }),
    PROCESS_LIFECYCLE.ARCHIVED
  );
  assert.equal(isProcessArchived({ lifecycle_status: "archived", is_published: true }), true);
});

test("draft lifecycle is the safe default", () => {
  assert.equal(resolveProcessLifecycle({}), PROCESS_LIFECYCLE.DRAFT);
  assert.equal(isProcessDraft({}), true);
  assert.deepEqual(assertProcessDraftMutable({}), {
    ok: true,
    lifecycle: PROCESS_LIFECYCLE.DRAFT,
  });
});

test("published and archived definitions are immutable", () => {
  assert.deepEqual(assertProcessDraftMutable({ lifecycle_status: "published" }), {
    ok: false,
    lifecycle: PROCESS_LIFECYCLE.PUBLISHED,
    error: "PROCESS_DEF_PUBLISHED_IMMUTABLE",
  });
  assert.deepEqual(assertProcessDraftMutable({ lifecycle_status: "archived" }), {
    ok: false,
    lifecycle: PROCESS_LIFECYCLE.ARCHIVED,
    error: "PROCESS_DEF_ARCHIVED_IMMUTABLE",
  });
});

test("draft revision metadata preserves provenance without keeping publish markers", () => {
  const attrs = buildProcessDraftAttrs(
    {
      module: "core",
      lifecycle_status: "published",
      is_published: true,
      published_at: "2026-09-11T00:00:00.000Z",
    },
    {
      revision_of_process_def_id: "11111111-1111-4111-8111-111111111111",
      revision_of_version: 3,
    }
  );

  assert.equal(attrs.module, "core");
  assert.equal(attrs.lifecycle_status, "draft");
  assert.equal(attrs.is_published, false);
  assert.equal("published_at" in attrs, false);
  assert.equal(attrs.revision_of_process_def_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(attrs.revision_of_version, 3);
});

test("publish and archive projections set explicit lifecycle metadata", () => {
  const published = buildProcessPublishedAttrs(
    { module: "core" },
    {
      published_at: "2026-09-12T10:00:00.000Z",
      published_by_identity_id: "22222222-2222-4222-8222-222222222222",
    }
  );
  assert.equal(published.lifecycle_status, "published");
  assert.equal(published.is_published, true);
  assert.equal(published.published_at, "2026-09-12T10:00:00.000Z");

  const archived = buildProcessArchivedAttrs(published, {
    archived_at: "2026-09-12T11:00:00.000Z",
  });
  assert.equal(archived.lifecycle_status, "archived");
  assert.equal(archived.is_published, false);
  assert.equal(archived.is_archived, true);
  assert.equal(archived.archived_at, "2026-09-12T11:00:00.000Z");
});

test("next revision version is computed per process code", () => {
  const rows = [
    { code: "ORDER_FLOW", version: 1 },
    { code: "ORDER_FLOW", version: 3 },
    { code: "OTHER_FLOW", version: 9 },
  ];
  assert.equal(resolveNextProcessVersion(rows, "ORDER_FLOW"), 4);
  assert.equal(resolveNextProcessVersion([], "ORDER_FLOW"), 1);
});

test("runtime eligibility requires active published definition", () => {
  assert.deepEqual(
    processRuntimeEligibility({ is_active: true, attrs: { lifecycle_status: "published" } }),
    { ok: true, lifecycle: "published" }
  );

  assert.deepEqual(
    processRuntimeEligibility({ is_active: true, attrs: { lifecycle_status: "draft" } }),
    { ok: false, lifecycle: "draft", error: "PROCESS_DEF_NOT_PUBLISHED" }
  );

  assert.deepEqual(
    processRuntimeEligibility({ is_active: true, attrs: { lifecycle_status: "archived" } }),
    { ok: false, lifecycle: "archived", error: "PROCESS_DEF_ARCHIVED" }
  );

  assert.deepEqual(
    processRuntimeEligibility({ is_active: false, attrs: { lifecycle_status: "published" } }),
    { ok: false, lifecycle: "published", error: "PROCESS_DEF_INACTIVE" }
  );
});
