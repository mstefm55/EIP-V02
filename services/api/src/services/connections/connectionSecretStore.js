import crypto from "node:crypto";
import { sha256Hex } from "../../auth/crypto.js";
import { requiredConnectionCredentialKinds } from "./connectionActivation.js";
import { normalizeConnectionCode } from "./connectionProfile.js";

const SECRET_KIND_PATTERN = /^[a-z][a-z0-9_:-]{1,63}$/;
const DEFAULT_KEY_ID = "connection-v1";

class ConnectionSecretError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "ConnectionSecretError";
    this.code = code;
    this.status = status;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeSecretKind(value) {
  const kind = text(value).toLowerCase();
  if (!SECRET_KIND_PATTERN.test(kind)) {
    throw new ConnectionSecretError("Secret kind is invalid.", "CONNECTION_SECRET_KIND_INVALID", 400);
  }
  return kind;
}

function decodeEncryptionKey(value) {
  const raw = text(value);
  if (!raw) {
    throw new ConnectionSecretError(
      "Connection secret encryption is not configured.",
      "CONNECTION_SECRET_KEY_UNAVAILABLE",
      503
    );
  }

  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  let decoded;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    decoded = null;
  }
  if (!decoded || decoded.length !== 32) {
    throw new ConnectionSecretError(
      "Connection secret encryption key must be 32 bytes (64 hex characters or base64).",
      "CONNECTION_SECRET_KEY_INVALID",
      503
    );
  }
  return decoded;
}

function resolveConnectionSecretConfig(config = {}) {
  return {
    key: decodeEncryptionKey(config.CONNECTION_SECRET_ENCRYPTION_KEY),
    keyId: text(config.CONNECTION_SECRET_KEY_ID) || DEFAULT_KEY_ID,
  };
}

function buildAad({ tenantId, connectionCode, secretKind, version, keyId }) {
  return `eip-v2:connection-secret:${tenantId}:${connectionCode}:${secretKind}:v${version}:${keyId}`;
}

function encryptValue({ plaintext, tenantId, connectionCode, secretKind, version, key, keyId }) {
  const value = String(plaintext ?? "");
  if (!value || value.length > 16_384) {
    throw new ConnectionSecretError(
      "Secret value must contain 1-16384 characters.",
      "CONNECTION_SECRET_VALUE_INVALID",
      400
    );
  }

  const iv = crypto.randomBytes(12);
  const aad = buildAad({ tenantId, connectionCode, secretKind, version, keyId });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    iv_b64: iv.toString("base64"),
    auth_tag_b64: authTag.toString("base64"),
    ciphertext_b64: ciphertext.toString("base64"),
    fingerprint: sha256Hex(value),
  };
}

function decryptRow(row, key) {
  if (!row) return null;
  const aad = buildAad({
    tenantId: row.tenant_id,
    connectionCode: row.connection_code,
    secretKind: row.secret_kind,
    version: row.version,
    keyId: row.key_id,
  });
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(row.iv_b64, "base64")
  );
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(row.auth_tag_b64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext_b64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function assertGovernedSecretKind(client, secretKind) {
  const result = await client.query(
    `
    SELECT 1
    FROM eip_core.dropdown_list dl
    JOIN eip_core.dropdown_value dv ON dv.list_id = dl.id
    WHERE dl.tenant_id IS NULL
      AND dl.module = 'integration'
      AND dl.code = 'CONNECTION_SECRET_KIND'
      AND dl.is_active = true
      AND dv.code = $1
      AND dv.is_active = true
    LIMIT 1
    `,
    [secretKind]
  );
  if (result.rowCount !== 1) {
    throw new ConnectionSecretError(
      "Secret kind is not enabled by governed metadata.",
      "CONNECTION_SECRET_KIND_NOT_GOVERNED",
      400
    );
  }
}

async function assertConnectionExists(client, tenantId, connectionCode) {
  const result = await client.query(
    `
    SELECT setting_value, setting_status
    FROM tenant.tenant_settings
    WHERE tenant_id = $1::uuid
      AND setting_key = $2
      AND setting_status <> 'deprecated'
    LIMIT 1
    `,
    [tenantId, `connection.profile.${connectionCode}`]
  );
  if (result.rowCount !== 1) {
    throw new ConnectionSecretError("Connection profile was not found.", "CONNECTION_NOT_FOUND", 404);
  }
  return result.rows[0];
}

function publicSecretStatus(row) {
  if (!row) {
    return {
      configured: false,
      status: "missing",
      version: null,
      fingerprint: null,
      last_rotated_at: null,
      revoked_at: null,
    };
  }
  return {
    configured: row.status === "active",
    status: row.status,
    version: row.version,
    fingerprint: row.fingerprint,
    last_rotated_at: row.created_at || null,
    revoked_at: row.revoked_at || null,
  };
}

async function getSecretStatus(client, tenantId, connectionCode, secretKind) {
  const code = normalizeConnectionCode(connectionCode);
  const kind = normalizeSecretKind(secretKind);
  const result = await client.query(
    `
    SELECT status, version, fingerprint, created_at, revoked_at
    FROM tenant.connection_secret
    WHERE tenant_id = $1::uuid
      AND connection_code = $2
      AND secret_kind = $3
    ORDER BY version DESC
    LIMIT 1
    `,
    [tenantId, code, kind]
  );
  return publicSecretStatus(result.rows[0] || null);
}

async function listSecretStatuses(client, tenantId, connectionCode) {
  const code = normalizeConnectionCode(connectionCode);
  const result = await client.query(
    `
    SELECT DISTINCT ON (secret_kind)
           secret_kind, status, version, fingerprint, created_at, revoked_at
    FROM tenant.connection_secret
    WHERE tenant_id = $1::uuid
      AND connection_code = $2
    ORDER BY secret_kind, version DESC
    `,
    [tenantId, code]
  );
  return Object.fromEntries(
    result.rows.map((row) => [row.secret_kind, publicSecretStatus(row)])
  );
}

async function rotateSecret({
  client,
  tenantId,
  connectionCode,
  secretKind,
  plaintext,
  actorIdentityId,
  config,
}) {
  const code = normalizeConnectionCode(connectionCode);
  const kind = normalizeSecretKind(secretKind);
  if (!client || typeof client.query !== "function") {
    throw new TypeError("Secret rotation requires an existing tenant transaction client.");
  }

  await assertConnectionExists(client, tenantId, code);
  await assertGovernedSecretKind(client, kind);
  const { key, keyId } = resolveConnectionSecretConfig(config);

  const rows = await client.query(
    `
    SELECT id, version, status
    FROM tenant.connection_secret
    WHERE tenant_id = $1::uuid
      AND connection_code = $2
      AND secret_kind = $3
    ORDER BY version DESC
    FOR UPDATE
    `,
    [tenantId, code, kind]
  );
  const previous = rows.rows[0] || null;
  const version = Number(previous?.version || 0) + 1;
  const encrypted = encryptValue({
    plaintext,
    tenantId,
    connectionCode: code,
    secretKind: kind,
    version,
    key,
    keyId,
  });

  if (previous) {
    await client.query(
      `
      UPDATE tenant.connection_secret
      SET status = 'superseded',
          updated_at = now()
      WHERE tenant_id = $1::uuid
        AND connection_code = $2
        AND secret_kind = $3
        AND status = 'active'
      `,
      [tenantId, code, kind]
    );
  }

  const inserted = await client.query(
    `
    INSERT INTO tenant.connection_secret
      (tenant_id, connection_code, secret_kind, version, status, algorithm, key_id,
       iv_b64, auth_tag_b64, ciphertext_b64, fingerprint, rotated_from_id,
       rotated_by_identity_id, attrs, created_at, updated_at)
    VALUES
      ($1::uuid, $2, $3, $4, 'active', 'aes-256-gcm', $5,
       $6, $7, $8, $9, $10::uuid, $11::uuid, '{}'::jsonb, now(), now())
    RETURNING id, status, version, fingerprint, created_at, revoked_at
    `,
    [
      tenantId,
      code,
      kind,
      version,
      keyId,
      encrypted.iv_b64,
      encrypted.auth_tag_b64,
      encrypted.ciphertext_b64,
      encrypted.fingerprint,
      previous?.id || null,
      actorIdentityId || null,
    ]
  );

  return publicSecretStatus(inserted.rows[0]);
}

async function revokeSecret({ client, tenantId, connectionCode, secretKind, actorIdentityId }) {
  const code = normalizeConnectionCode(connectionCode);
  const kind = normalizeSecretKind(secretKind);
  if (!client || typeof client.query !== "function") {
    throw new TypeError("Secret revocation requires an existing tenant transaction client.");
  }
  const connectionRow = await assertConnectionExists(client, tenantId, code);
  await assertGovernedSecretKind(client, kind);

  const profile = connectionRow?.setting_value && typeof connectionRow.setting_value === "object"
    ? connectionRow.setting_value
    : {};
  const profileEnabled = profile?.identity?.is_enabled === true || connectionRow?.setting_status === "active";
  const requiredKinds = requiredConnectionCredentialKinds(profile);
  if (profileEnabled && requiredKinds.includes(kind)) {
    throw new ConnectionSecretError(
      "This credential is required by an enabled connection. Disable the connection before revoking it.",
      "CONNECTION_SECRET_REQUIRED_BY_ACTIVE_PROFILE",
      409
    );
  }

  const result = await client.query(
    `
    UPDATE tenant.connection_secret
    SET status = 'revoked',
        revoked_at = now(),
        revoked_by_identity_id = $4::uuid,
        updated_at = now()
    WHERE tenant_id = $1::uuid
      AND connection_code = $2
      AND secret_kind = $3
      AND status = 'active'
    RETURNING status, version, fingerprint, created_at, revoked_at
    `,
    [tenantId, code, kind, actorIdentityId || null]
  );
  if (result.rowCount !== 1) {
    throw new ConnectionSecretError("No active secret exists for this kind.", "CONNECTION_SECRET_NOT_FOUND", 404);
  }
  return publicSecretStatus(result.rows[0]);
}

async function readSecret({ client, tenantId, connectionCode, secretKind, config }) {
  const code = normalizeConnectionCode(connectionCode);
  const kind = normalizeSecretKind(secretKind);
  if (!client || typeof client.query !== "function") {
    throw new TypeError("Secret read requires an existing tenant transaction client.");
  }
  const { key } = resolveConnectionSecretConfig(config);
  const result = await client.query(
    `
    SELECT tenant_id, connection_code, secret_kind, version, key_id,
           iv_b64, auth_tag_b64, ciphertext_b64
    FROM tenant.connection_secret
    WHERE tenant_id = $1::uuid
      AND connection_code = $2
      AND secret_kind = $3
      AND status = 'active'
    LIMIT 1
    `,
    [tenantId, code, kind]
  );
  if (result.rowCount !== 1) return null;
  return decryptRow(result.rows[0], key);
}

export {
  ConnectionSecretError,
  SECRET_KIND_PATTERN,
  decryptRow,
  encryptValue,
  getSecretStatus,
  listSecretStatuses,
  normalizeSecretKind,
  publicSecretStatus,
  readSecret,
  resolveConnectionSecretConfig,
  revokeSecret,
  rotateSecret,
};
