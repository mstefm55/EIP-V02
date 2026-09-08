import { withTenantTransaction } from "../../db/tenantTransaction.js";
import {
  ConnectionProfileError,
  createConnectionProfile,
  getConnectionProfile,
  mergeEditableProfile,
  normalizeProfile,
  profileKey,
  updateConnectionProfile,
} from "./connectionProfile.js";
import { listSecretStatuses } from "./connectionSecretStore.js";
import { validateConnectionActivation } from "./connectionActivation.js";

function text(value) {
  return String(value ?? "").trim();
}

async function assertUniqueInboundPath(pool, tenantId, profile) {
  const suffix = text(profile?.inbound?.inbound_path_suffix);
  if (!suffix) return;
  const key = profileKey(profile?.identity?.connection_code);

  const conflict = await withTenantTransaction(pool, tenantId, async (client) => {
    const result = await client.query(
      `
      SELECT setting_key
      FROM tenant.tenant_settings
      WHERE tenant_id = $1::uuid
        AND setting_key LIKE 'connection.profile.%'
        AND setting_status <> 'deprecated'
        AND setting_key <> $2
        AND COALESCE(setting_value->'inbound'->>'inbound_path_suffix', '') = $3
      LIMIT 1
      `,
      [tenantId, key, suffix]
    );
    return result.rows[0] || null;
  });

  if (conflict) {
    throw new ConnectionProfileError(
      "Inbound path suffix is already used by another connection in this organisation.",
      "CONNECTION_INBOUND_PATH_CONFLICT",
      409,
      [
        {
          path: "inbound.inbound_path_suffix",
          code: "CONNECTION_INBOUND_PATH_CONFLICT",
          message: "Inbound path suffix must be unique within the authenticated organisation.",
        },
      ]
    );
  }
}

async function createConnectionProfileGuarded(pool, tenantId, input, taxonomy) {
  const profile = normalizeProfile(input);
  if (profile.identity?.is_enabled === true) {
    throw new ConnectionProfileError(
      "Connections must be created as disabled drafts before credentials and activation are configured.",
      "CONNECTION_CREATE_ENABLED_FORBIDDEN",
      400,
      [
        {
          path: "identity.is_enabled",
          code: "CONNECTION_CREATE_ENABLED_FORBIDDEN",
          message: "Create the connection as disabled, configure required credentials, then enable it.",
        },
      ]
    );
  }

  await assertUniqueInboundPath(pool, tenantId, profile);
  return createConnectionProfile(pool, tenantId, profile, taxonomy);
}

async function updateConnectionProfileGuarded(pool, tenantId, connectionCode, input, taxonomy) {
  const current = await getConnectionProfile(pool, tenantId, connectionCode);
  if (!current || current.setting_status === "deprecated") {
    throw new ConnectionProfileError("Connection profile was not found.", "CONNECTION_NOT_FOUND", 404);
  }

  const merged = mergeEditableProfile(current, input);
  await assertUniqueInboundPath(pool, tenantId, merged);

  if (merged.identity?.is_enabled === true) {
    const credentialStatuses = await withTenantTransaction(pool, tenantId, (client) =>
      listSecretStatuses(client, tenantId, connectionCode)
    );
    const activationErrors = validateConnectionActivation(merged, credentialStatuses);
    if (activationErrors.length > 0) {
      throw new ConnectionProfileError(
        "Connection activation requirements are not met.",
        "CONNECTION_ACTIVATION_BLOCKED",
        400,
        activationErrors
      );
    }
  }

  return updateConnectionProfile(pool, tenantId, connectionCode, merged, taxonomy);
}

export {
  assertUniqueInboundPath,
  createConnectionProfileGuarded,
  updateConnectionProfileGuarded,
};
