import assert from "node:assert/strict";
import test from "node:test";

import {
  createConnectionProfile,
  updateConnectionProfile,
} from "../src/services/connections/connectionProfile.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SETTING_ID = "22222222-2222-4222-8222-222222222222";

const taxonomy = {
  CONNECTION_KIND: [{ code: "custom" }],
  CONNECTION_DIRECTION: [{ code: "inbound" }, { code: "outbound" }, { code: "both" }],
  CONNECTION_ENVIRONMENT: [{ code: "sandbox" }, { code: "production" }],
  CONNECTION_VERIFICATION_MODE: [{ code: "none" }, { code: "api_key" }, { code: "hmac_signature" }],
  CONNECTION_AUTH_MODE: [{ code: "none" }, { code: "api_key_header" }],
  CONNECTION_CHANNEL: [{ code: "custom" }],
  CONNECTION_MAPPING_MODE: [{ code: "passthrough" }, { code: "mapped" }],
  CONNECTION_HTTP_METHOD: [{ code: "GET" }, { code: "POST" }],
  CONNECTION_LOG_LEVEL: [{ code: "info" }],
  CONNECTION_EVENT_ID_LOCATION: [{ code: "header" }, { code: "query" }, { code: "body" }],
  CONNECTION_IDEMPOTENCY_SCOPE: [{ code: "connection" }, { code: "tenant" }],
};

function disabledInboundProfile() {
  return {
    profile_version: 1,
    identity: {
      connection_name: "Orders intake",
      connection_code: "orders_intake",
      connection_kind: "custom",
      direction: "inbound",
      environment: "production",
      frontend_url: "",
      portal_url: "",
      is_enabled: false,
    },
    inbound: {
      inbound_path_suffix: "orders",
      webhook_enabled: true,
      http_method: "POST",
      expected_content_type: "application/json",
      origin_allowlist: [],
      raw_body_required: true,
      rate_limit: { max: null, window_sec: null },
    },
    verification: {
      mode: "api_key",
      allow_unverified: false,
      api_key: { header_name: "x-api-key" },
      hmac_signature: {
        header_name: "",
        algorithm: "",
        encoding: "",
        payload_mode: "",
        timestamp_header: "",
        max_skew_sec: null,
      },
      oauth2_jwt: {
        header_name: "",
        token_prefix: "",
        issuer: "",
        audience: "",
        jwks_url: "",
        max_skew_sec: null,
        max_age_sec: null,
      },
    },
    idempotency: {
      event_id_location: "header",
      event_id_key: "x-event-id",
      idempotency_scope: "connection",
    },
    outbound: {
      base_url: "",
      path_prefix: "",
      auth_mode: "",
      auth: {
        header_name: "",
        query_param_name: "",
        public_key_ref: "",
        username: "",
        client_id: "",
        client_auth_method: "",
        token_url: "",
        scope: "",
      },
      default_headers: {},
      timeout_ms: null,
      retry_policy: { max_retries: null, backoff_ms: null },
      healthcheck_path: "",
      test_request_method: "",
    },
    routing: {
      channel: "custom",
      protocol: "http",
      provider_code: "",
      supported_message_types: [],
      schema_version: "v1",
      envelope_profile: "canonical_v1",
      mapping_mode: "passthrough",
      mapping: {},
    },
    audit: {
      audit_record_type: "connection_transport",
      redaction_policy: {},
      max_body_size: 65536,
      ip_allowlist: [],
      log_level: "info",
    },
    attrs: {},
    health: {},
    credential_status: {},
  };
}

function poolForProfile(profile) {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, params = []) {
      const source = String(sql);
      calls.push({ sql: source, params });
      if (source === "BEGIN" || source === "COMMIT" || source === "ROLLBACK") {
        return { rowCount: 0, rows: [] };
      }
      if (source.includes("set_config('app.current_tenant_id'")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (source.includes("FROM tenant.tenant_settings") && source.includes("FOR UPDATE")) {
        return {
          rowCount: 1,
          rows: [{
            tenant_setting_id: SETTING_ID,
            setting_key: "connection.profile.orders_intake",
            setting_value: profile,
            setting_status: "disabled",
            created_at: "2026-09-09T00:00:00.000Z",
            updated_at: "2026-09-09T00:00:00.000Z",
          }],
        };
      }
      if (source.includes("UPDATE tenant.tenant_settings")) {
        return {
          rowCount: 1,
          rows: [{
            tenant_setting_id: SETTING_ID,
            setting_key: "connection.profile.orders_intake",
            setting_value: JSON.parse(params[2]),
            setting_status: params[3],
            created_at: "2026-09-09T00:00:00.000Z",
            updated_at: "2026-09-09T00:01:00.000Z",
          }],
        };
      }
      throw new Error(`Unexpected query: ${source}`);
    },
    release() {
      released = true;
    },
  };
  return {
    pool: { connect: async () => client },
    client,
    calls,
    wasReleased: () => released,
  };
}

function transactionEndedWith(calls, statement) {
  return calls.some((entry) => entry.sql === statement);
}

test("new connections cannot bypass the disabled-draft lifecycle", async () => {
  await assert.rejects(
    () => createConnectionProfile(
      {},
      TENANT,
      {
        identity: {
          connection_name: "Unsafe direct activation",
          connection_code: "unsafe_direct",
          connection_kind: "custom",
          environment: "production",
          is_enabled: true,
        },
      },
      taxonomy
    ),
    (error) =>
      error?.code === "CONNECTION_ACTIVATION_REQUIRES_DRAFT"
      && error?.status === 400
      && error?.errors?.some((entry) => entry.code === "ACTIVATION_REQUIRES_DRAFT")
  );
});

test("enabling a profile without the required credential rolls back before persistence", async () => {
  const fixture = poolForProfile(disabledInboundProfile());
  let loaderClient = null;

  await assert.rejects(
    () => updateConnectionProfile(
      fixture.pool,
      TENANT,
      "orders_intake",
      { identity: { is_enabled: true } },
      taxonomy,
      {
        loadCredentialStatuses: async (client, tenantId, connectionCode) => {
          loaderClient = client;
          assert.equal(tenantId, TENANT);
          assert.equal(connectionCode, "orders_intake");
          return {};
        },
      }
    ),
    (error) =>
      error?.code === "CONNECTION_ACTIVATION_BLOCKED"
      && error?.status === 409
      && error?.errors?.some((entry) => entry.code === "ACTIVATION_CREDENTIAL_REQUIRED")
  );

  assert.equal(loaderClient, fixture.client);
  assert.equal(fixture.calls.some((entry) => entry.sql.includes("UPDATE tenant.tenant_settings")), false);
  assert.equal(transactionEndedWith(fixture.calls, "ROLLBACK"), true);
  assert.equal(fixture.wasReleased(), true);
});

test("enabling a profile fails closed when credential readiness cannot be checked", async () => {
  const fixture = poolForProfile(disabledInboundProfile());

  await assert.rejects(
    () => updateConnectionProfile(
      fixture.pool,
      TENANT,
      "orders_intake",
      { identity: { is_enabled: true } },
      taxonomy
    ),
    (error) => error?.code === "CONNECTION_ACTIVATION_CHECK_UNAVAILABLE" && error?.status === 503
  );

  assert.equal(fixture.calls.some((entry) => entry.sql.includes("UPDATE tenant.tenant_settings")), false);
  assert.equal(transactionEndedWith(fixture.calls, "ROLLBACK"), true);
});

test("activation commits only after the required credential passes in the same tenant transaction", async () => {
  const fixture = poolForProfile(disabledInboundProfile());
  let loaderClient = null;

  const item = await updateConnectionProfile(
    fixture.pool,
    TENANT,
    "orders_intake",
    { identity: { is_enabled: true } },
    taxonomy,
    {
      loadCredentialStatuses: async (client) => {
        loaderClient = client;
        return {
          api_key: {
            configured: true,
            status: "active",
            version: 1,
            fingerprint: "safe-fingerprint",
          },
        };
      },
    }
  );

  assert.equal(loaderClient, fixture.client);
  assert.equal(item.identity.is_enabled, true);
  assert.equal(item.setting_status, "active");
  assert.equal(transactionEndedWith(fixture.calls, "COMMIT"), true);
  assert.equal(transactionEndedWith(fixture.calls, "ROLLBACK"), false);
  assert.equal(fixture.wasReleased(), true);
});
