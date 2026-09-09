import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { resolveDbConfig } from "./migrationDbConfig.mjs";
import {
  DEFAULT_BOOTSTRAP_PERMISSION_CODES,
  mergeBootstrapPermissionCodes,
} from "./bootstrapPermissionProfile.mjs";

function normalize(value) {
  return String(value ?? "").trim();
}

function parseApply(value) {
  return ["1", "true", "yes", "apply"].includes(normalize(value).toLowerCase());
}

function readCanonicalPermissions(attrs) {
  return Array.isArray(attrs?.permissions) ? attrs.permissions : [];
}

async function main() {
  const tenantCode = normalize(process.env.OWNER_ADMIN_REPAIR_TENANT_CODE);
  const login = normalize(process.env.OWNER_ADMIN_REPAIR_LOGIN);
  const apply = parseApply(process.env.OWNER_ADMIN_REPAIR_APPLY);

  if (!tenantCode || !login) {
    throw new Error(
      "OWNER_ADMIN_REPAIR_TENANT_CODE and OWNER_ADMIN_REPAIR_LOGIN are required. The repair is dry-run unless OWNER_ADMIN_REPAIR_APPLY=true."
    );
  }

  const pool = new pg.Pool(resolveDbConfig(process.env));
  const client = await pool.connect();
  try {
    const found = await client.query(
      `
      SELECT ai.id,
             ai.tenant_id,
             ai.login,
             ai.is_active,
             ai.is_locked,
             ai.attrs,
             t.tenant_code,
             t.tenant_name,
             t.tenant_status
      FROM eip_auth.auth_identity ai
      JOIN kernel.tenants t ON t.tenant_id = ai.tenant_id
      WHERE lower(t.tenant_code) = lower($1)
        AND lower(ai.login) = lower($2)
      LIMIT 2
      `,
      [tenantCode, login]
    );

    if (found.rowCount !== 1) {
      throw new Error(
        found.rowCount === 0
          ? "Owner Admin repair target was not found for the supplied tenant code and login."
          : "Owner Admin repair target is ambiguous; expected exactly one identity."
      );
    }

    const row = found.rows[0];
    if (row.tenant_status !== "active") {
      throw new Error(`Owner Admin repair target tenant is not active (${row.tenant_status}).`);
    }
    if (!row.is_active || row.is_locked) {
      throw new Error("Owner Admin repair target identity must be active and unlocked before permissions are repaired.");
    }

    const before = readCanonicalPermissions(row.attrs);
    const after = mergeBootstrapPermissionCodes(before);
    const missing = DEFAULT_BOOTSTRAP_PERMISSION_CODES.filter((code) => !before.includes(code));

    if (!apply) {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        applied: false,
        tenant_code: row.tenant_code,
        tenant_name: row.tenant_name,
        login: row.login,
        identity_id: row.id,
        missing_permission_codes: missing,
        resulting_permission_codes: after,
      }, null, 2)}\n`);
      return;
    }

    await client.query("BEGIN");
    const updated = await client.query(
      `
      UPDATE eip_auth.auth_identity
      SET attrs = jsonb_set(
            COALESCE(attrs, '{}'::jsonb),
            '{permissions}',
            to_jsonb($3::text[]),
            true
          ),
          updated_at = now()
      WHERE tenant_id = $1::uuid
        AND id = $2::uuid
        AND is_active = true
        AND is_locked = false
      RETURNING id
      `,
      [row.tenant_id, row.id, after]
    );

    if (updated.rowCount !== 1) {
      throw new Error("Owner Admin repair target changed during repair; no permissions were applied.");
    }
    await client.query("COMMIT");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      applied: true,
      tenant_code: row.tenant_code,
      tenant_name: row.tenant_name,
      login: row.login,
      identity_id: row.id,
      added_permission_codes: missing,
      permission_codes: after,
    }, null, 2)}\n`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error?.message ?? String(error) }, null, 2)}\n`);
    process.exit(1);
  });
}

export { main, parseApply, readCanonicalPermissions };
