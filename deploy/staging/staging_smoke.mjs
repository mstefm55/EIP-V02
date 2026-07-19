import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicOrigin = String(process.env.STAGING_PUBLIC_ORIGIN || "https://localhost:8443").trim();
const allowInsecureTls =
  String(process.env.STAGING_SMOKE_ALLOW_INSECURE_TLS || "true").trim().toLowerCase() !== "false";

if (publicOrigin.startsWith("https://") && allowInsecureTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

function fail(message) {
  throw new Error(message);
}

async function expectStatus(url, expectedStatus, label) {
  const response = await fetch(url, { headers: { Origin: publicOrigin } });
  if (response.status !== expectedStatus) {
    fail(`${label} expected status ${expectedStatus}, got ${response.status}`);
  }
  return response;
}

async function parseJson(response, label) {
  try {
    return await response.json();
  } catch {
    fail(`${label} returned non-JSON response`);
  }
}

async function runHttpChecks() {
  const health = await expectStatus(`${publicOrigin}/api/public/health`, 200, "api health");
  const healthBody = await parseJson(health, "api health");
  if (healthBody?.ok !== true) fail("api health payload not ok=true");

  const dbHealth = await expectStatus(`${publicOrigin}/api/public/health/db`, 200, "db health");
  const dbBody = await parseJson(dbHealth, "db health");
  if (dbBody?.checks?.db?.ok !== true) fail("db health payload not ok=true");

  const ui = await expectStatus(`${publicOrigin}/`, 200, "ui root");
  const html = await ui.text();
  if (!html.includes("<div id=\"root\"></div>")) {
    fail("ui root did not return expected workbench shell");
  }

  await expectStatus(`${publicOrigin}/api/eip/auth/whoami`, 401, "unauth whoami");
}

function runPlaywrightStagingSmoke() {
  const env = {
    ...process.env,
    WORKBENCH_BASE_URL: publicOrigin,
    E2E_API_ORIGIN: publicOrigin,
    E2E_UI_ORIGIN: publicOrigin,
    E2E_API_ENV_FILE: String(process.env.E2E_API_ENV_FILE || ".env.v2.staging").trim(),
    E2E_TENANT_CODE: String(process.env.STAGING_SMOKE_TENANT_CODE || "v2seed").trim(),
    E2E_ADMIN_LOGIN: String(process.env.STAGING_SMOKE_ADMIN_LOGIN || "v2.workbench.admin").trim(),
    E2E_LIMITED_LOGIN: String(process.env.STAGING_SMOKE_LIMITED_LOGIN || "v2.workbench.limited").trim(),
    E2E_SHARED_PASSWORD: String(process.env.STAGING_SMOKE_SHARED_PASSWORD || "").trim(),
  };

  if (!env.E2E_SHARED_PASSWORD) {
    fail("STAGING_SMOKE_SHARED_PASSWORD is required for staging smoke");
  }

  const runScript = path.join(root, "apps", "workbench-ui", "tests", "run-staging-smoke.mjs");
  const result = spawnSync(process.execPath, [runScript], {
    cwd: path.join(root, "apps", "workbench-ui"),
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    fail(`playwright staging smoke failed with status ${result.status ?? 1}`);
  }
}

await runHttpChecks();
runPlaywrightStagingSmoke();
process.stdout.write(`[staging-smoke] all checks passed for ${publicOrigin}\n`);
