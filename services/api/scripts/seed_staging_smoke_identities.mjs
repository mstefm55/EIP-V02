import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePasswordStrength } from "../src/auth/password.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const bootstrapPath = path.join(root, "scripts", "bootstrap_v2_auth_seed.mjs");
const DEFAULT_SMOKE_PASSWORD = "V2Smoke!Pass123";

const tenantId = String(process.env.V2_BOOTSTRAP_TENANT_ID || "11111111-1111-4111-8111-111111111111").trim();
const tenantCode = String(process.env.V2_BOOTSTRAP_TENANT_CODE || "v2seed").trim();
const tenantName = String(process.env.V2_BOOTSTRAP_TENANT_NAME || "V2 Seed Tenant").trim();
const sharedPassword = String(process.env.STAGING_SMOKE_SHARED_PASSWORD || process.env.E2E_SHARED_PASSWORD || "").trim();
const adminLogin = String(process.env.STAGING_SMOKE_ADMIN_LOGIN || "v2.workbench.admin").trim();
const limitedLogin = String(process.env.STAGING_SMOKE_LIMITED_LOGIN || "v2.workbench.limited").trim();
const adminEmail = String(process.env.STAGING_SMOKE_ADMIN_EMAIL || process.env.SMTP_USER || `${adminLogin}@eip.local`).trim();
const limitedEmail = String(process.env.STAGING_SMOKE_LIMITED_EMAIL || process.env.SMTP_USER || `${limitedLogin}@eip.local`).trim();
const defaultEmail = String(process.env.STAGING_SMOKE_DEFAULT_EMAIL || process.env.SMTP_USER || "").trim();

if (!sharedPassword) {
  throw new Error("STAGING_SMOKE_SHARED_PASSWORD is required");
}

if (/^replace_me$/i.test(sharedPassword)) {
  throw new Error(
    "STAGING_SMOKE_SHARED_PASSWORD cannot be 'replace_me'. Use a policy-compliant value " +
      "(example: V2Smoke!Pass123) in services/api/.env.v2.staging and deploy/staging/.env.staging."
  );
}

const passwordStrength = evaluatePasswordStrength(sharedPassword);
if (!passwordStrength.ok) {
  throw new Error(
    `STAGING_SMOKE_SHARED_PASSWORD failed policy: ${passwordStrength.feedback.join("; ")}. ` +
      `Use a compliant value (example: ${DEFAULT_SMOKE_PASSWORD}).`
  );
}

function seed(login, permissionCodes, email) {
  const env = {
    ...process.env,
    V2_BOOTSTRAP_TENANT_ID: tenantId,
    V2_BOOTSTRAP_TENANT_CODE: tenantCode,
    V2_BOOTSTRAP_TENANT_NAME: tenantName,
    V2_BOOTSTRAP_LOGIN: login,
    V2_BOOTSTRAP_PASSWORD: sharedPassword,
    V2_BOOTSTRAP_PERMISSION_CODES: permissionCodes,
    V2_BOOTSTRAP_EMAIL: email,
    V2_BOOTSTRAP_EMAIL_DEFAULT: defaultEmail,
  };

  const result = spawnSync(
    process.execPath,
    [bootstrapPath],
    {
      cwd: root,
      env,
      stdio: "inherit",
    }
  );

  if (result.status !== 0) {
    throw new Error(`seed failed for ${login}`);
  }
}

seed(
  adminLogin,
  "PROCESS_DEF_READ,PROCESS_DEF_WRITE,CRM_PROCESS_DEF_READ,CRM_PROCESS_DEF_WRITE,PROCESS_INSTANCE_READ,PROCESS_INSTANCE_WRITE",
  adminEmail
);
seed(limitedLogin, "UNRELATED_PERMISSION", limitedEmail);
process.stdout.write(
  `${JSON.stringify({ ok: true, admin_login: adminLogin, admin_email: adminEmail, limited_login: limitedLogin, limited_email: limitedEmail }, null, 2)}\n`
);
