import crypto from "node:crypto";

import { buildServer } from "../src/server.js";
import { extractPermissionCodes } from "../src/security/permissionPolicy.js";
import { withTenantTransaction } from "../src/db/tenantTransaction.js";

const REQUIRED_PERMISSIONS = Object.freeze([
  "OWNER_ADMIN_CONSOLE_READ",
  "OWNER_ADMIN_CONNECTION_READ",
  "OWNER_ADMIN_CONNECTION_WRITE",
  "OWNER_ADMIN_CONNECTION_SECRET_MANAGE",
  "OWNER_ADMIN_CONNECTION_TEST",
]);

function text(value) {
  return String(value ?? "").trim();
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
}

function assert(condition, message) {
  if (!condition) throw new Error(`CONNECTION_ACCEPTANCE_FAILED: ${message}`);
}

function parseJsonResponse(response, label) {
  try {
    return JSON.parse(response.body || "null");
  } catch {
    throw new Error(`CONNECTION_ACCEPTANCE_FAILED: ${label} did not return JSON (status ${response.statusCode})`);
  }
}

function assertStatus(response, expected, label) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert(allowed.includes(response.statusCode), `${label} returned ${response.statusCode}; expected ${allowed.join("/")}`);
  return parseJsonResponse(response, label);
}

function safeSegment(value, fallback = "run") {
  const normalized = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return normalized || fallback;
}

function chooseOrigin(corsOrigin) {
  if (Array.isArray(corsOrigin)) {
    const candidate = corsOrigin.find((entry) => text(entry) && text(entry) !== "*");
    if (candidate) return text(candidate);
  }
  if (typeof corsOrigin === "string" && corsOrigin !== "*") return text(corsOrigin);
  return "https://connections-acceptance.eip.invalid";
}

function chooseTaxonomyCode(taxonomy, listCode, preferred) {
  const rows = Array.isArray(taxonomy?.[listCode]) ? taxonomy[listCode] : [];
  const active = rows.map((row) => text(row?.code ?? row)).filter(Boolean);
  if (preferred && active.includes(preferred)) return preferred;
  assert(active.length > 0, `governed taxonomy ${listCode} has no active values`);
  return active[0];
}

function buildCookieHeader(sid, csrf) {
  return `sid=${encodeURIComponent(sid)}; csrf=${encodeURIComponent(csrf)}`;
}

function responseDoesNotContain(payload, secret) {
  return !secret || !JSON.stringify(payload).includes(secret);
}

async function readAdminIdentity(app, tenantCode, login) {
  const tenantResult = await app.db.query(
    `
    SELECT tenant_id, tenant_code, tenant_name
    FROM kernel.tenants
    WHERE lower(tenant_code) = lower($1)
      AND tenant_status = 'active'
    LIMIT 1
    `,
    [tenantCode]
  );
  assert(tenantResult.rowCount === 1, `admin tenant ${tenantCode} is unavailable`);
  const tenant = tenantResult.rows[0];

  const identityResult = await app.db.query(
    `
    SELECT id, login, is_active, is_locked, COALESCE(attrs, '{}'::jsonb) AS attrs
    FROM eip_auth.auth_identity
    WHERE tenant_id = $1::uuid
      AND lower(login) = lower($2)
    LIMIT 1
    `,
    [tenant.tenant_id, login]
  );
  assert(identityResult.rowCount === 1, `admin identity ${login} is unavailable`);
  const identity = identityResult.rows[0];
  assert(identity.is_active === true && identity.is_locked !== true, "admin acceptance identity is not active/unlocked");

  const permissions = extractPermissionCodes(identity.attrs || {});
  for (const permission of REQUIRED_PERMISSIONS) {
    assert(permissions.includes(permission), `admin identity is missing ${permission}`);
  }

  return { tenant, identity };
}

async function findCompletedRun(app, targetTenantId, runId) {
  return withTenantTransaction(app.db, targetTenantId, async (client) => {
    const result = await client.query(
      `
      SELECT setting_key, setting_status
      FROM tenant.tenant_settings
      WHERE tenant_id = $1::uuid
        AND setting_key LIKE 'connection.profile.%'
        AND setting_value #>> '{attrs,acceptance,run_id}' = $2
        AND setting_status = 'deprecated'
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      [targetTenantId, runId]
    );
    return result.rows[0] || null;
  });
}

async function selectBoundProcess(app, targetTenantId) {
  return withTenantTransaction(app.db, targetTenantId, async (client) => {
    const result = await client.query(
      `
      SELECT pb.service_object_type, pd.id AS process_def_id, pd.code AS process_code, pd.version
      FROM eip_core.process_binding pb
      JOIN eip_core.process_def pd
        ON pd.id = pb.process_def_id
       AND pd.tenant_id = pb.tenant_id
      WHERE pb.tenant_id = $1::uuid
        AND pb.is_active = true
        AND pd.is_active = true
        AND (
          NOT EXISTS (
            SELECT 1
            FROM eip_core.dropdown_list dl
            WHERE dl.code = 'SERVICE_OBJECT_TYPE'
              AND dl.is_active = true
              AND (dl.tenant_id = $1::uuid OR dl.tenant_id IS NULL)
          )
          OR EXISTS (
            SELECT 1
            FROM eip_core.dropdown_list dl
            JOIN eip_core.dropdown_value dv ON dv.list_id = dl.id
            WHERE dl.code = 'SERVICE_OBJECT_TYPE'
              AND dl.is_active = true
              AND dv.is_active = true
              AND (dl.tenant_id = $1::uuid OR dl.tenant_id IS NULL)
              AND lower(dv.code) = lower(pb.service_object_type)
          )
        )
      ORDER BY pb.priority ASC, pd.version DESC, pd.code ASC
      LIMIT 1
      `,
      [targetTenantId]
    );
    assert(result.rowCount === 1, "no active governed process binding is available for mapped inbound acceptance");
    return result.rows[0];
  });
}

async function createIsolationTenantIfNeeded(app, targetTenantId, runSegment) {
  const existing = await app.db.query(
    `
    SELECT tenant_id, tenant_code, tenant_name
    FROM kernel.tenants
    WHERE tenant_status = 'active'
      AND tenant_id <> $1::uuid
    ORDER BY tenant_code
    LIMIT 1
    `,
    [targetTenantId]
  );
  if (existing.rowCount === 1) return { tenant: existing.rows[0], temporary: false };

  const tenant = {
    tenant_id: crypto.randomUUID(),
    tenant_code: `accept-isolation-${runSegment}`.slice(0, 80),
    tenant_name: `Connections Acceptance Isolation ${runSegment}`.slice(0, 160),
  };
  await app.db.query(
    `
    INSERT INTO kernel.tenants
      (tenant_id, tenant_code, tenant_name, tenancy_mode, tenant_status, created_at, updated_at)
    VALUES
      ($1::uuid, $2, $3, 'POOL', 'active', now(), now())
    `,
    [tenant.tenant_id, tenant.tenant_code, tenant.tenant_name]
  );
  return { tenant, temporary: true };
}

async function deleteTemporaryIsolationTenant(app, isolation) {
  if (!isolation?.temporary || !isolation?.tenant?.tenant_id) return;
  await app.db.query(
    `DELETE FROM kernel.tenants WHERE tenant_id = $1::uuid AND tenant_code = $2`,
    [isolation.tenant.tenant_id, isolation.tenant.tenant_code]
  );
}

async function cleanupMappedArtifact(app, targetTenantId, serviceObjectId, runId) {
  if (!serviceObjectId) return;
  await withTenantTransaction(app.db, targetTenantId, async (client) => {
    const owned = await client.query(
      `
      SELECT id
      FROM eip_core.service_object
      WHERE tenant_id = $1::uuid
        AND id = $2::uuid
        AND attrs ->> 'acceptance_run_id' = $3
      LIMIT 1
      `,
      [targetTenantId, serviceObjectId, runId]
    );
    if (owned.rowCount !== 1) return;
    await client.query(
      `DELETE FROM eip_core.service_object WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [targetTenantId, serviceObjectId]
    );
  });
}

async function verifyDeprecatedEvidence(app, targetTenantId, connectionCode, runId) {
  return withTenantTransaction(app.db, targetTenantId, async (client) => {
    const profile = await client.query(
      `
      SELECT setting_status, setting_value
      FROM tenant.tenant_settings
      WHERE tenant_id = $1::uuid
        AND setting_key = $2
      LIMIT 1
      `,
      [targetTenantId, `connection.profile.${connectionCode}`]
    );
    assert(profile.rowCount === 1, "deprecated connection profile evidence was not retained");
    const row = profile.rows[0];
    assert(row.setting_status === "deprecated", "connection profile did not retain deprecated lifecycle status");
    assert(row.setting_value?.identity?.is_enabled === false, "deprecated connection remains enabled");
    assert(row.setting_value?.attrs?.acceptance?.run_id === runId, "acceptance run provenance was not retained");
    assert(Boolean(row.setting_value?.attrs?.lifecycle?.deprecated_at), "deprecation timestamp evidence is missing");

    const activeSecret = await client.query(
      `
      SELECT count(*)::int AS count
      FROM tenant.connection_secret
      WHERE tenant_id = $1::uuid
        AND connection_code = $2
        AND status = 'active'
      `,
      [targetTenantId, connectionCode]
    );
    assert(activeSecret.rows[0]?.count === 0, "deprecation left an active connection credential behind");

    return {
      lifecycle_retained: true,
      credentials_active: activeSecret.rows[0]?.count || 0,
    };
  });
}

async function main() {
  if (!truthy(process.env.CONNECTION_ACCEPTANCE_APPLY)) {
    process.stdout.write(`${JSON.stringify({ ok: true, skipped: true, reason: "CONNECTION_ACCEPTANCE_APPLY_NOT_TRUE" })}\n`);
    return;
  }

  const runId = text(process.env.CONNECTION_ACCEPTANCE_RUN_ID);
  const adminTenantCode = text(process.env.CONNECTION_ACCEPTANCE_ADMIN_TENANT_CODE);
  const adminLogin = text(process.env.CONNECTION_ACCEPTANCE_ADMIN_LOGIN);
  const targetTenantCode = text(process.env.CONNECTION_ACCEPTANCE_TARGET_TENANT_CODE);
  assert(runId, "CONNECTION_ACCEPTANCE_RUN_ID is required");
  assert(adminTenantCode, "CONNECTION_ACCEPTANCE_ADMIN_TENANT_CODE is required");
  assert(adminLogin, "CONNECTION_ACCEPTANCE_ADMIN_LOGIN is required");
  assert(targetTenantCode, "CONNECTION_ACCEPTANCE_TARGET_TENANT_CODE is required");
  if (targetTenantCode.toLowerCase() !== "v2seed" && !truthy(process.env.CONNECTION_ACCEPTANCE_ALLOW_NON_SEED)) {
    throw new Error("CONNECTION_ACCEPTANCE_FAILED: refusing to mutate a non-v2seed tenant without CONNECTION_ACCEPTANCE_ALLOW_NON_SEED=true");
  }

  const runSegment = safeSegment(runId);
  const app = await buildServer({ logger: false, config: { rateLimitMax: 100000, rateLimitWindow: "1 minute" } });
  await app.ready();

  let sessionRecord = null;
  let adminTenantId = null;
  let connectionCode = null;
  let targetTenant = null;
  let isolation = null;
  let mappedServiceObjectId = null;
  let deprecated = false;

  const summary = {
    admin_authority: false,
    ui_surface: false,
    tenant_catalogue: false,
    create_disabled_draft: false,
    incomplete_draft: false,
    early_activation_blocked: false,
    credential_generated_once: false,
    credential_rotation: false,
    plaintext_not_reexposed: false,
    activation_ready: false,
    endpoint_projection: false,
    inbound_readiness: false,
    active_required_secret_protected: false,
    old_rotated_key_rejected: false,
    inbound_accepted: false,
    duplicate_suppressed: false,
    idempotency_conflict: false,
    rate_limit_429: false,
    mapped_process_dispatch: false,
    external_process_authority_rejected: false,
    tenant_isolation_read: false,
    tenant_isolation_write: false,
    tenant_isolation_test: false,
    tenant_isolation_public_route: false,
    disable_safe: false,
    disabled_secret_revoke: false,
    delete_deprecate: false,
    audit_retained: false,
    credentials_revoked_on_delete: false,
  };

  try {
    const admin = await readAdminIdentity(app, adminTenantCode, adminLogin);
    adminTenantId = admin.tenant.tenant_id;
    summary.admin_authority = true;

    const targetLookup = await app.db.query(
      `
      SELECT tenant_id, tenant_code, tenant_name
      FROM kernel.tenants
      WHERE lower(tenant_code) = lower($1)
        AND tenant_status = 'active'
      LIMIT 1
      `,
      [targetTenantCode]
    );
    assert(targetLookup.rowCount === 1, `target tenant ${targetTenantCode} is unavailable`);
    targetTenant = targetLookup.rows[0];

    const completed = await findCompletedRun(app, targetTenant.tenant_id, runId);
    if (completed) {
      process.stdout.write(`${JSON.stringify({ ok: true, already_completed: true, run_id: runId, setting_status: completed.setting_status }, null, 2)}\n`);
      return;
    }

    const userAgent = `EIP-Connections-Acceptance/${runSegment}`;
    const origin = chooseOrigin(app.config.corsOrigin);
    sessionRecord = await app.createSession({
      tenantId: admin.tenant.tenant_id,
      identityId: admin.identity.id,
      realm: "EIP",
      assurance: "totp",
      ip: "127.0.0.1",
      userAgent,
    });
    const commonHeaders = {
      cookie: buildCookieHeader(sessionRecord.sid, sessionRecord.csrf),
      origin,
      "user-agent": userAgent,
    };
    const writeHeaders = {
      ...commonHeaders,
      "x-csrf": sessionRecord.csrf,
      "content-type": "application/json",
    };

    assertStatus(await app.inject({ method: "GET", url: "/api/eip/owner-admin/account", headers: commonHeaders }), 200, "Owner Admin account");

    const surfacePayload = assertStatus(
      await app.inject({ method: "GET", url: "/api/eip/ui/surfaces/owner_connections", headers: commonHeaders }),
      200,
      "Connections UI surface"
    );
    const surfaceText = JSON.stringify(surfacePayload);
    assert(surfaceText.includes("connection_setup_v2"), "Connections surface is not the canonical seven-step composition");
    assert(surfaceText.includes("connection_tenant"), "Connections surface is missing server-governed target-tenant selection");
    assert(surfaceText.includes("hide_on_create"), "Connections surface is missing create-time activation visibility metadata");
    summary.ui_surface = true;

    const tenantsPayload = assertStatus(
      await app.inject({ method: "GET", url: "/api/eip/owner-admin/connections/tenants", headers: commonHeaders }),
      200,
      "Connections tenant catalogue"
    );
    assert(Array.isArray(tenantsPayload.items), "Connections tenant catalogue did not return an items array");
    assert(tenantsPayload.items.some((item) => text(item.code).toLowerCase() === targetTenantCode.toLowerCase()), "target tenant is absent from the server-provided Connections allow-list");
    summary.tenant_catalogue = true;

    const taxonomyPayload = assertStatus(
      await app.inject({ method: "GET", url: "/api/eip/owner-admin/connections/taxonomy", headers: commonHeaders }),
      200,
      "Connections taxonomy"
    );
    const taxonomy = taxonomyPayload.taxonomy || {};
    const connectionKind = chooseTaxonomyCode(taxonomy, "CONNECTION_KIND", "custom");
    const environment = chooseTaxonomyCode(taxonomy, "CONNECTION_ENVIRONMENT", "sandbox");
    const direction = chooseTaxonomyCode(taxonomy, "CONNECTION_DIRECTION", "inbound");
    const channel = chooseTaxonomyCode(taxonomy, "CONNECTION_CHANNEL", "custom");
    const mappingPassthrough = chooseTaxonomyCode(taxonomy, "CONNECTION_MAPPING_MODE", "passthrough");
    const verificationMode = chooseTaxonomyCode(taxonomy, "CONNECTION_VERIFICATION_MODE", "api_key");
    const eventLocation = chooseTaxonomyCode(taxonomy, "CONNECTION_EVENT_ID_LOCATION", "header");
    const idempotencyScope = chooseTaxonomyCode(taxonomy, "CONNECTION_IDEMPOTENCY_SCOPE", "connection");
    const logLevel = chooseTaxonomyCode(taxonomy, "CONNECTION_LOG_LEVEL", "info");

    const targetBase = `/api/eip/owner-admin/connections/tenants/${encodeURIComponent(targetTenantCode)}`;
    const createPayload = assertStatus(
      await app.inject({
        method: "POST",
        url: targetBase,
        headers: writeHeaders,
        payload: {
          identity: {
            connection_name: `Connections Acceptance ${runSegment}`,
            connection_kind: connectionKind,
            environment,
            is_enabled: false,
          },
          attrs: { acceptance: { run_id: runId, purpose: "production_closeout" } },
        },
      }),
      201,
      "create disabled Connection draft"
    );
    connectionCode = text(createPayload?.item?.identity?.connection_code);
    assert(connectionCode, "server did not generate a Connection code");
    assert(createPayload?.item?.identity?.is_enabled === false, "new Connection was not created disabled");
    assert(createPayload?.item?.setting_status === "disabled", "new Connection setting status is not disabled");
    summary.create_disabled_draft = true;
    summary.incomplete_draft = true;

    const detailUrl = `${targetBase}/${encodeURIComponent(connectionCode)}`;
    const detailPayload = assertStatus(await app.inject({ method: "GET", url: detailUrl, headers: commonHeaders }), 200, "read disabled Connection draft");
    assert(detailPayload?.item?.identity?.connection_code === connectionCode, "persisted generated Connection code changed");

    const earlyPayload = assertStatus(
      await app.inject({ method: "PATCH", url: detailUrl, headers: writeHeaders, payload: { identity: { direction, is_enabled: true } } }),
      [400, 409],
      "early Connection activation"
    );
    assert(["CONNECTION_ACTIVATION_BLOCKED", "CONNECTION_PROFILE_INVALID"].includes(earlyPayload.error), "early activation did not fail through governed readiness validation");
    assert(Array.isArray(earlyPayload.errors) && earlyPayload.errors.length > 0, "early activation did not return actionable blockers");
    summary.early_activation_blocked = true;

    const suffix = `accept-${runSegment}-${crypto.randomBytes(3).toString("hex")}`.slice(0, 120);
    assertStatus(
      await app.inject({
        method: "PATCH",
        url: detailUrl,
        headers: writeHeaders,
        payload: {
          identity: { direction, is_enabled: false },
          inbound: {
            webhook_enabled: true,
            inbound_path_suffix: suffix,
            http_method: "POST",
            expected_content_type: "application/json",
            raw_body_required: true,
            rate_limit: { max: 4, window_sec: 60 },
          },
          verification: { mode: verificationMode, allow_unverified: false, api_key: { header_name: "x-api-key" } },
          idempotency: { event_id_location: eventLocation, event_id_key: "x-event-id", idempotency_scope: idempotencyScope },
          routing: { channel, protocol: "https", schema_version: "acceptance-v1", envelope_profile: "json", mapping_mode: mappingPassthrough, mapping: {} },
          audit: { log_level: logLevel, max_body_size: 131072 },
        },
      }),
      200,
      "configure disabled Connection"
    );

    const readinessBeforePayload = assertStatus(await app.inject({ method: "GET", url: `${detailUrl}/readiness`, headers: commonHeaders }), 200, "readiness before credential");
    assert(readinessBeforePayload?.readiness?.activation?.ready === false, "activation unexpectedly ready before required credential");
    assert((readinessBeforePayload?.readiness?.activation?.blockers || []).some((entry) => entry?.code === "ACTIVATION_CREDENTIAL_REQUIRED"), "missing credential was not reported as an activation blocker");

    const keyOnePayload = assertStatus(await app.inject({ method: "POST", url: `${detailUrl}/api-key/generate`, headers: writeHeaders }), 200, "generate Connection API key");
    const rawKeyOne = text(keyOnePayload.raw_key);
    assert(rawKeyOne.length >= 20 && keyOnePayload.shown_once === true, "generated API key was not returned as a one-time value");
    summary.credential_generated_once = true;

    const secretStatusOnePayload = assertStatus(await app.inject({ method: "GET", url: `${detailUrl}/secrets`, headers: commonHeaders }), 200, "read Connection secret status");
    assert(responseDoesNotContain(secretStatusOnePayload, rawKeyOne), "secret status re-exposed the raw API key");
    assert(secretStatusOnePayload?.items?.api_key?.configured === true, "generated API key is not reported configured");
    const firstVersion = Number(secretStatusOnePayload?.items?.api_key?.version || 0);

    const keyTwoPayload = assertStatus(await app.inject({ method: "POST", url: `${detailUrl}/api-key/generate`, headers: writeHeaders }), 200, "rotate generated Connection API key");
    const rawKeyTwo = text(keyTwoPayload.raw_key);
    assert(rawKeyTwo && rawKeyTwo !== rawKeyOne, "API-key rotation did not produce a new one-time value");
    const secondVersion = Number(keyTwoPayload?.api_key?.version || 0);
    assert(secondVersion > firstVersion, "API-key rotation did not advance credential version");
    summary.credential_rotation = true;

    const detailAfterRotationPayload = assertStatus(await app.inject({ method: "GET", url: detailUrl, headers: commonHeaders }), 200, "reload Connection after key rotation");
    assert(responseDoesNotContain(detailAfterRotationPayload, rawKeyOne) && responseDoesNotContain(detailAfterRotationPayload, rawKeyTwo), "Connection detail re-exposed a raw credential");
    summary.plaintext_not_reexposed = true;

    const enablePayload = assertStatus(await app.inject({ method: "PATCH", url: detailUrl, headers: writeHeaders, payload: { identity: { is_enabled: true } } }), 200, "enable ready Connection");
    assert(enablePayload?.item?.identity?.is_enabled === true, "ready Connection did not enable");

    const readinessPayload = assertStatus(await app.inject({ method: "GET", url: `${detailUrl}/readiness`, headers: commonHeaders }), 200, "ready Connection readiness");
    assert(readinessPayload?.readiness?.activation?.ready === true, "enabled Connection is not activation-ready");
    assert(readinessPayload?.readiness?.inbound?.ready === true, "enabled Connection is not inbound-ready");
    summary.activation_ready = true;

    const inboundReadinessPayload = assertStatus(await app.inject({ method: "POST", url: `${detailUrl}/test/inbound-readiness`, headers: writeHeaders }), 200, "inbound readiness test");
    assert(inboundReadinessPayload?.result?.ready === true, "inbound readiness test did not pass");
    summary.inbound_readiness = true;

    const endpointPayload = assertStatus(await app.inject({ method: "GET", url: `${detailUrl}/endpoints`, headers: commonHeaders }), 200, "live endpoint projection");
    const endpointText = JSON.stringify(endpointPayload?.endpoints || {});
    assert(endpointText.includes(targetTenantCode) && endpointText.includes(suffix), "live endpoint projection is not tenant/suffix derived");
    summary.endpoint_projection = true;

    const revokeActivePayload = assertStatus(await app.inject({ method: "POST", url: `${detailUrl}/secrets/api_key/revoke`, headers: writeHeaders }), 409, "revoke required active credential");
    assert(revokeActivePayload.error === "CONNECTION_SECRET_REQUIRED_BY_ACTIVE_PROFILE", "active required credential did not fail closed with the governed lifecycle error");
    summary.active_required_secret_protected = true;

    const publicUrl = `/api/public/gateway/intake/${encodeURIComponent(targetTenantCode)}/${encodeURIComponent(suffix)}`;
    const inboundHeaders = (key, eventId) => ({ "content-type": "application/json", "x-api-key": key, "x-event-id": eventId });

    const oldKeyResponse = await app.inject({ method: "POST", url: publicUrl, headers: inboundHeaders(rawKeyOne, `old-${runSegment}`), payload: JSON.stringify({ value: 1 }) });
    assert([401, 403].includes(oldKeyResponse.statusCode), `rotated-out API key returned ${oldKeyResponse.statusCode}`);
    summary.old_rotated_key_rejected = true;

    const eventOne = `evt-${runSegment}-1`;
    const eventPayload = JSON.stringify({ value: 10, marker: runId });
    const firstInboundPayload = assertStatus(await app.inject({ method: "POST", url: publicUrl, headers: inboundHeaders(rawKeyTwo, eventOne), payload: eventPayload }), 202, "first inbound request");
    assert(firstInboundPayload.accepted === true && firstInboundPayload.duplicate === false, "first inbound request was not accepted as new");
    assert(firstInboundPayload.dispatch_status === "NOT_BOUND", "passthrough inbound unexpectedly started business processing");
    summary.inbound_accepted = true;

    const duplicatePayload = assertStatus(await app.inject({ method: "POST", url: publicUrl, headers: inboundHeaders(rawKeyTwo, eventOne), payload: eventPayload }), 202, "duplicate inbound request");
    assert(duplicatePayload.duplicate === true && duplicatePayload.dispatch_status === "DUPLICATE_SUPPRESSED", "identical duplicate was not suppressed");
    summary.duplicate_suppressed = true;

    const conflictPayload = assertStatus(await app.inject({ method: "POST", url: publicUrl, headers: inboundHeaders(rawKeyTwo, eventOne), payload: JSON.stringify({ value: 11, marker: runId }) }), 409, "idempotency conflict");
    assert(Boolean(conflictPayload.error), "idempotency conflict did not return a bounded error");
    summary.idempotency_conflict = true;

    const ratePayload = assertStatus(await app.inject({ method: "POST", url: publicUrl, headers: inboundHeaders(rawKeyTwo, `evt-${runSegment}-2`), payload: JSON.stringify({ value: 12, marker: runId }) }), 429, "cluster-safe inbound rate limit");
    assert(Boolean(ratePayload.error), "rate-limit response did not return a bounded error");
    summary.rate_limit_429 = true;

    const disableForMappingPayload = assertStatus(await app.inject({ method: "PATCH", url: detailUrl, headers: writeHeaders, payload: { identity: { is_enabled: false } } }), 200, "disable before mapped reconfiguration");
    assert(disableForMappingPayload?.item?.identity?.is_enabled === false, "Connection did not disable before mapped reconfiguration");
    summary.disable_safe = true;

    const bound = await selectBoundProcess(app, targetTenant.tenant_id);
    const objectCode = `accept-so-${runSegment}-${crypto.randomBytes(3).toString("hex")}`.slice(0, 120);
    assertStatus(
      await app.inject({
        method: "PATCH",
        url: detailUrl,
        headers: writeHeaders,
        payload: {
          inbound: { rate_limit: { max: 100, window_sec: 60 } },
          routing: {
            mapping_mode: "mapped",
            mapping: {
              service_object: {
                object_type: bound.service_object_type,
                code: "$body.object_code",
                title: "$body.title",
                attrs: { acceptance_run_id: runId, external_id: "$body.external_id" },
              },
            },
          },
        },
      }),
      200,
      "configure mapped inbound Connection"
    );
    assertStatus(await app.inject({ method: "PATCH", url: detailUrl, headers: writeHeaders, payload: { identity: { is_enabled: true } } }), 200, "enable mapped inbound Connection");

    const bogusProcessId = "00000000-0000-4000-8000-000000000001";
    const mappedPayload = assertStatus(
      await app.inject({
        method: "POST",
        url: publicUrl,
        headers: inboundHeaders(rawKeyTwo, `mapped-${runSegment}`),
        payload: JSON.stringify({
          object_code: objectCode,
          title: `Acceptance ${runSegment}`,
          external_id: runId,
          process_def_id: bogusProcessId,
          tenant_id: "00000000-0000-4000-8000-000000000002",
        }),
      }),
      202,
      "mapped inbound Process dispatch"
    );
    assert(mappedPayload.dispatch_status === "PROCESS_STARTED", `mapped inbound dispatch status was ${mappedPayload.dispatch_status}`);
    assert(Boolean(mappedPayload.service_object_id) && Boolean(mappedPayload.process_instance_id), "mapped inbound dispatch did not return bounded Process evidence");
    assert(mappedPayload.process_def_id === bound.process_def_id, "mapped inbound did not resolve the canonical process_binding Process Definition");
    assert(mappedPayload.process_def_id !== bogusProcessId, "external payload gained Process Definition authority");
    mappedServiceObjectId = mappedPayload.service_object_id;
    summary.mapped_process_dispatch = true;
    summary.external_process_authority_rejected = true;

    const processEvidence = await withTenantTransaction(app.db, targetTenant.tenant_id, async (client) => {
      const result = await client.query(
        `
        SELECT pi.id, pi.tenant_id, pi.process_def_id, so.attrs
        FROM eip_core.process_instance pi
        JOIN eip_core.service_object so ON so.tenant_id = pi.tenant_id AND so.id = pi.service_object_id
        WHERE pi.tenant_id = $1::uuid AND pi.id = $2::uuid AND pi.service_object_id = $3::uuid
        LIMIT 1
        `,
        [targetTenant.tenant_id, mappedPayload.process_instance_id, mappedPayload.service_object_id]
      );
      return result.rows[0] || null;
    });
    assert(processEvidence?.tenant_id === targetTenant.tenant_id, "mapped Process evidence is outside the target tenant");
    assert(processEvidence?.process_def_id === bound.process_def_id, "persisted Process instance does not match governed binding");
    assert(processEvidence?.attrs?.acceptance_run_id === runId, "mapped Service Object did not preserve bounded mapped attrs");

    isolation = await createIsolationTenantIfNeeded(app, targetTenant.tenant_id, runSegment);
    const otherCode = isolation.tenant.tenant_code;
    const otherBase = `/api/eip/owner-admin/connections/tenants/${encodeURIComponent(otherCode)}`;
    assertStatus(await app.inject({ method: "GET", url: `${otherBase}/${encodeURIComponent(connectionCode)}`, headers: commonHeaders }), 404, "cross-tenant Connection read");
    summary.tenant_isolation_read = true;
    assertStatus(await app.inject({ method: "PATCH", url: `${otherBase}/${encodeURIComponent(connectionCode)}`, headers: writeHeaders, payload: { identity: { is_enabled: false } } }), 404, "cross-tenant Connection write");
    summary.tenant_isolation_write = true;
    assertStatus(await app.inject({ method: "POST", url: `${otherBase}/${encodeURIComponent(connectionCode)}/test/inbound-readiness`, headers: writeHeaders }), 404, "cross-tenant Connection test");
    summary.tenant_isolation_test = true;
    assertStatus(await app.inject({ method: "POST", url: `/api/public/gateway/intake/${encodeURIComponent(otherCode)}/${encodeURIComponent(suffix)}`, headers: inboundHeaders(rawKeyTwo, `other-${runSegment}`), payload: JSON.stringify({ value: 1 }) }), 404, "cross-tenant public gateway route");
    summary.tenant_isolation_public_route = true;

    assertStatus(await app.inject({ method: "PATCH", url: detailUrl, headers: writeHeaders, payload: { identity: { is_enabled: false } } }), 200, "final Connection disable");

    const revokeDisabledPayload = assertStatus(await app.inject({ method: "POST", url: `${detailUrl}/secrets/api_key/revoke`, headers: writeHeaders }), 200, "revoke credential after disable");
    assert(revokeDisabledPayload?.secret?.status === "revoked", "credential did not revoke after Connection disable");
    summary.disabled_secret_revoke = true;

    const generateBeforeDeletePayload = assertStatus(await app.inject({ method: "POST", url: `${detailUrl}/api-key/generate`, headers: writeHeaders }), 200, "generate credential before deprecation");
    assert(Boolean(text(generateBeforeDeletePayload.raw_key)), "pre-deprecation credential generation failed");

    const deletePayload = assertStatus(await app.inject({ method: "DELETE", url: detailUrl, headers: writeHeaders }), 200, "deprecate Connection");
    assert(deletePayload?.item?.status === "deprecated", "Delete did not map to governed deprecation");
    deprecated = true;
    summary.delete_deprecate = true;

    const listAfterDeletePayload = assertStatus(await app.inject({ method: "GET", url: targetBase, headers: commonHeaders }), 200, "Connection catalogue after deprecation");
    assert(!(listAfterDeletePayload.items || []).some((item) => item?.connection_code === connectionCode), "deprecated Connection remains in the active catalogue");
    assertStatus(await app.inject({ method: "GET", url: detailUrl, headers: commonHeaders }), 404, "deprecated Connection detail");

    const evidence = await verifyDeprecatedEvidence(app, targetTenant.tenant_id, connectionCode, runId);
    summary.audit_retained = evidence.lifecycle_retained === true;
    summary.credentials_revoked_on_delete = evidence.credentials_active === 0;

    const failed = Object.entries(summary).filter(([, value]) => value !== true);
    assert(failed.length === 0, `acceptance summary contains incomplete checks: ${failed.map(([key]) => key).join(", ")}`);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      run_id: runId,
      target_tenant_code: targetTenantCode,
      connection_code: connectionCode,
      process_binding: {
        service_object_type: bound.service_object_type,
        process_def_id: bound.process_def_id,
        process_code: bound.process_code,
        version: bound.version,
      },
      checks: summary,
    }, null, 2)}\n`);
  } finally {
    if (connectionCode && targetTenant?.tenant_id && !deprecated && sessionRecord) {
      const userAgent = `EIP-Connections-Acceptance/${runSegment}`;
      const headers = {
        cookie: buildCookieHeader(sessionRecord.sid, sessionRecord.csrf),
        origin: chooseOrigin(app.config.corsOrigin),
        "user-agent": userAgent,
        "x-csrf": sessionRecord.csrf,
        "content-type": "application/json",
      };
      const base = `/api/eip/owner-admin/connections/tenants/${encodeURIComponent(targetTenantCode)}/${encodeURIComponent(connectionCode)}`;
      await app.inject({ method: "PATCH", url: base, headers, payload: { identity: { is_enabled: false } } }).catch(() => undefined);
      await app.inject({ method: "DELETE", url: base, headers }).catch(() => undefined);
    }
    if (mappedServiceObjectId && targetTenant?.tenant_id) {
      await cleanupMappedArtifact(app, targetTenant.tenant_id, mappedServiceObjectId, runId).catch(() => undefined);
    }
    await deleteTemporaryIsolationTenant(app, isolation).catch(() => undefined);
    if (sessionRecord?.sid) {
      await app.revokeSession(sessionRecord.sid, adminTenantId).catch(() => undefined);
    }
    await app.close().catch(() => undefined);
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2)}\n`);
  process.exit(1);
});
