import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeEditableProfile,
  normalizeProfile,
  sanitizeJson,
  summarizeProfile,
  validateConnectionProfile,
} from "../src/services/connections/connectionProfile.js";

const taxonomy = {
  CONNECTION_KIND: [{ code: "custom" }],
  CONNECTION_DIRECTION: [{ code: "inbound" }, { code: "outbound" }, { code: "both" }],
  CONNECTION_ENVIRONMENT: [{ code: "sandbox" }, { code: "production" }],
  CONNECTION_VERIFICATION_MODE: [{ code: "none" }, { code: "api_key" }],
  CONNECTION_AUTH_MODE: [{ code: "none" }, { code: "api_key_header" }],
  CONNECTION_CHANNEL: [{ code: "custom" }],
  CONNECTION_MAPPING_MODE: [{ code: "passthrough" }],
  CONNECTION_HTTP_METHOD: [{ code: "GET" }, { code: "POST" }],
  CONNECTION_LOG_LEVEL: [{ code: "info" }],
};

function validProfile(overrides = {}) {
  return normalizeProfile({
    identity: {
      connection_name: "Example",
      connection_code: "example_conn",
      connection_kind: "custom",
      direction: "inbound",
      environment: "sandbox",
      is_enabled: true,
    },
    inbound: {
      inbound_path_suffix: "example",
      http_method: "POST",
    },
    verification: { mode: "api_key" },
    outbound: { auth_mode: "none", test_request_method: "GET" },
    idempotency: { event_id_location: "header", event_id_key: "X-Event-Id" },
    routing: {
      channel: "custom",
      mapping_mode: "passthrough",
      schema_version: "v1",
      envelope_profile: "canonical_v1",
    },
    audit: { log_level: "info" },
    ...overrides,
  });
}

test("profile normalization strips secret-bearing values and sensitive headers", () => {
  const profile = normalizeProfile({
    identity: {
      connection_name: "Secure",
      connection_code: "secure_conn",
      connection_kind: "custom",
      direction: "outbound",
      environment: "sandbox",
    },
    verification: {
      mode: "api_key",
      api_key: { header_name: "X-API-Key", secret: "must-not-survive" },
    },
    outbound: {
      base_url: "https://example.com",
      auth_mode: "api_key_header",
      auth: {
        header_name: "X-API-Key",
        secret: "must-not-survive",
        client_secret: "must-not-survive",
      },
      default_headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
        "X-API-Key": "secret",
      },
    },
    idempotency: { event_id_location: "header", event_id_key: "X-Event-Id" },
    routing: { channel: "custom", mapping_mode: "passthrough" },
    audit: { log_level: "info" },
  });

  assert.equal(profile.verification.api_key.secret, undefined);
  assert.equal(profile.outbound.auth.secret, undefined);
  assert.equal(profile.outbound.auth.client_secret, undefined);
  assert.equal(profile.outbound.default_headers.Authorization, undefined);
  assert.equal(profile.outbound.default_headers["X-API-Key"], undefined);
  assert.equal(profile.outbound.default_headers.Accept, "application/json");
});

test("recursive sanitizer blocks prototype and common credential keys", () => {
  const sanitized = sanitizeJson({
    safe: "value",
    nested: {
      password: "hidden",
      token: "hidden",
      label: "kept",
    },
    constructor: { polluted: true },
  });

  assert.deepEqual(sanitized, { safe: "value", nested: { label: "kept" } });
});

test("new profiles default to disabled drafts without inventing governed reference values", () => {
  const profile = normalizeProfile({
    identity: {
      connection_name: "Draft",
      connection_code: "draft_conn",
      connection_kind: "custom",
      direction: "outbound",
      environment: "sandbox",
    },
  });

  assert.equal(profile.identity.is_enabled, false);
  assert.equal(profile.verification.mode, "");
  assert.equal(profile.outbound.auth_mode, "");
  assert.equal(profile.routing.channel, "");
  assert.equal(profile.routing.mapping_mode, "");
  assert.equal(profile.audit.log_level, "");
  assert.deepEqual(validateConnectionProfile(profile, taxonomy), []);

  profile.identity.is_enabled = true;
  const activationErrors = validateConnectionProfile(profile, taxonomy);
  assert.ok(activationErrors.some((error) => error.path === "outbound.base_url"));
  assert.ok(activationErrors.some((error) => error.path === "verification.mode"));
  assert.ok(activationErrors.some((error) => error.path === "routing.channel"));
});

test("production inbound profile fails closed when verification is none", () => {
  const profile = validProfile({
    identity: {
      connection_name: "Production",
      connection_code: "prod_conn",
      connection_kind: "custom",
      direction: "inbound",
      environment: "production",
      is_enabled: true,
    },
    verification: { mode: "none", allow_unverified: false },
  });

  const errors = validateConnectionProfile(profile, taxonomy);
  assert.ok(errors.some((error) => error.code === "PRODUCTION_VERIFICATION_REQUIRED"));
});

test("unknown governed taxonomy values are rejected", () => {
  const profile = validProfile();
  profile.identity.connection_kind = "not-governed";
  const errors = validateConnectionProfile(profile, taxonomy);
  assert.ok(errors.some((error) => error.path === "identity.connection_kind"));
});

test("partial edits preserve server-owned health and credential status", () => {
  const existing = validProfile();
  existing.health = { status: "healthy", checked_at: "2026-09-07T00:00:00Z" };
  existing.credential_status = { api_key: { configured: true, version: 2 } };

  const merged = mergeEditableProfile(existing, {
    identity: { connection_name: "Renamed" },
  });

  assert.equal(merged.identity.connection_name, "Renamed");
  assert.deepEqual(merged.health, existing.health);
  assert.deepEqual(merged.credential_status, existing.credential_status);
});

test("catalogue summary returns bounded UI-safe projection", () => {
  const profile = validProfile();
  profile.id = "4ec64025-040d-4a23-8780-20d114076323";
  profile.health = { status: "healthy", last_successful_test_at: "2026-09-07T00:00:00Z" };
  profile.updated_at = "2026-09-07T00:01:00Z";

  assert.deepEqual(summarizeProfile(profile), {
    id: profile.id,
    connection_code: "example_conn",
    connection_name: "Example",
    connection_kind: "custom",
    direction: "inbound",
    environment: "sandbox",
    is_enabled: true,
    health_status: "healthy",
    last_successful_test_at: "2026-09-07T00:00:00Z",
    setting_status: "active",
    updated_at: "2026-09-07T00:01:00Z",
  });
});
