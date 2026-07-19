import { spawnSync } from "node:child_process";

const API_CWD = "C:/Projects/EIP/eip-core-V2/services/api";
const API_ENV_FILE = String(process.env.E2E_API_ENV_FILE || ".env.v2.local").trim();
const SHARED_PASSWORD = String(process.env.E2E_SHARED_PASSWORD || "G7!rL2#pQ9$kZ4mN").trim();
const TENANT_ID = String(process.env.E2E_TENANT_ID || "11111111-1111-4111-8111-111111111111").trim();
const TENANT_CODE = String(process.env.E2E_TENANT_CODE || "v2seed").trim();
const TENANT_NAME = String(process.env.E2E_TENANT_NAME || "V2 Seed Tenant").trim();
const ADMIN_LOGIN = String(process.env.E2E_ADMIN_LOGIN || "v2.workbench.admin").trim();
const LIMITED_LOGIN = String(process.env.E2E_LIMITED_LOGIN || "v2.workbench.limited").trim();
const ADMIN_EMAIL = String(process.env.E2E_ADMIN_EMAIL || process.env.SMTP_USER || `${ADMIN_LOGIN}@eip.local`).trim();
const LIMITED_EMAIL = String(process.env.E2E_LIMITED_EMAIL || process.env.SMTP_USER || `${LIMITED_LOGIN}@eip.local`).trim();
const DEFAULT_EMAIL = String(process.env.E2E_DEFAULT_EMAIL || process.env.SMTP_USER || "").trim();

function runSeed({
  login,
  password,
  permissionCodes,
  email,
}) {
  const env = {
    ...process.env,
    V2_BOOTSTRAP_TENANT_ID: TENANT_ID,
    V2_BOOTSTRAP_TENANT_CODE: TENANT_CODE,
    V2_BOOTSTRAP_TENANT_NAME: TENANT_NAME,
    V2_BOOTSTRAP_LOGIN: login,
    V2_BOOTSTRAP_PASSWORD: password,
    V2_BOOTSTRAP_PERMISSION_CODES: permissionCodes,
    V2_BOOTSTRAP_EMAIL: email,
    V2_BOOTSTRAP_EMAIL_DEFAULT: DEFAULT_EMAIL,
  };

  const result = spawnSync(
    process.execPath,
    [`--env-file-if-exists=${API_ENV_FILE}`, "scripts/bootstrap_v2_auth_seed.mjs"],
    {
      cwd: API_CWD,
      env,
      stdio: "pipe",
      encoding: "utf8",
    }
  );

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    const spawnError = result.error ? String(result.error.message || result.error) : "";
    throw new Error(`auth seed failed for ${login}: ${stderr || stdout || spawnError || "unknown error"}`);
  }
}

export default async function globalSetup() {
  runSeed({
    login: ADMIN_LOGIN,
    password: SHARED_PASSWORD,
    email: ADMIN_EMAIL,
    permissionCodes: [
      "PROCESS_DEF_READ",
      "PROCESS_DEF_WRITE",
      "CRM_PROCESS_DEF_READ",
      "CRM_PROCESS_DEF_WRITE",
      "PROCESS_INSTANCE_READ",
      "PROCESS_INSTANCE_WRITE",
    ].join(","),
  });

  runSeed({
    login: LIMITED_LOGIN,
    password: SHARED_PASSWORD,
    email: LIMITED_EMAIL,
    permissionCodes: "UNRELATED_PERMISSION",
  });
}

export {
  SHARED_PASSWORD,
};
