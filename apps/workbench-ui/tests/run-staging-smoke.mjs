import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultBaseUrl = String(process.env.WORKBENCH_BASE_URL || "https://localhost:8443").trim();
const apiOrigin = String(process.env.E2E_API_ORIGIN || defaultBaseUrl).trim();
const uiOrigin = String(process.env.E2E_UI_ORIGIN || defaultBaseUrl).trim();

const env = {
  ...process.env,
  WORKBENCH_BASE_URL: defaultBaseUrl,
  E2E_API_ORIGIN: apiOrigin,
  E2E_UI_ORIGIN: uiOrigin,
  E2E_API_ENV_FILE: String(process.env.E2E_API_ENV_FILE || ".env.v2.staging").trim(),
};
const includeAuthoring = String(process.env.E2E_INCLUDE_AUTHORING || "false").trim().toLowerCase() === "true";
const args = ["./node_modules/@playwright/test/cli.js", "test", "--config", "./playwright.config.mjs"];
if (!includeAuthoring) {
  args.push("--grep-invert", "process builder supports governed authoring for defs/templates/bindings");
}

const result = spawnSync(
  process.execPath,
  args,
  {
    cwd: root,
    env,
    stdio: "inherit",
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
