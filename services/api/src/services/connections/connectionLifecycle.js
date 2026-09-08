import { withTenantTransaction } from "../../db/tenantTransaction.js";
import {
  ConnectionProfileError,
  normalizeConnectionCode,
  profileKey,
} from "./connectionProfile.js";

async function deprecateConnectionProfile(pool, tenantId, connectionCode, actorIdentityId = null) {
  const code = normalizeConnectionCode(connectionCode);
  const key = profileKey(code);

  return withTenantTransaction(pool, tenantId, async (client) => {
    const current = await client.query(
      `
      SELECT tenant_setting_id, setting_value, setting_status
      FROM tenant.tenant_settings
      WHERE tenant_id = $1::uuid
        AND setting_key = $2
      FOR UPDATE
      `,
      [tenantId, key]
    );

    if (current.rowCount !== 1 || current.rows[0].setting_status === "deprecated") {
      throw new ConnectionProfileError(
        "Connection profile was not found.",
        "CONNECTION_NOT_FOUND",
        404
      );
    }

    const deprecatedAt = new Date().toISOString();

    await client.query(
      `
      UPDATE tenant.tenant_settings
      SET setting_value = jsonb_set(
            jsonb_set(
              COALESCE(setting_value, '{}'::jsonb),
              '{identity,is_enabled}',
              'false'::jsonb,
              true
            ),
            '{attrs,lifecycle}',
            COALESCE(setting_value #> '{attrs,lifecycle}', '{}'::jsonb)
              || jsonb_build_object(
                   'deprecated_at', $3::text,
                   'deprecated_by_identity_id', $4::text
                 ),
            true
          ),
          setting_status = 'deprecated',
          updated_at = now()
      WHERE tenant_id = $1::uuid
        AND setting_key = $2
      `,
      [tenantId, key, deprecatedAt, actorIdentityId ? String(actorIdentityId) : null]
    );

    await client.query(
      `
      UPDATE tenant.connection_secret
      SET status = 'revoked',
          revoked_at = COALESCE(revoked_at, now()),
          revoked_by_identity_id = COALESCE(revoked_by_identity_id, $3::uuid),
          updated_at = now()
      WHERE tenant_id = $1::uuid
        AND connection_code = $2
        AND status = 'active'
      `,
      [tenantId, code, actorIdentityId || null]
    );

    return {
      connection_code: code,
      status: "deprecated",
      deprecated_at: deprecatedAt,
    };
  });
}

export { deprecateConnectionProfile };
