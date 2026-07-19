import { defineConfig } from "@playwright/test";

const apiCwd = "C:/Projects/EIP/eip-core-V2/services/api";
const uiCwd = "C:/Projects/EIP/eip-core-V2/apps/workbench-ui";
const externalBaseUrl = String(process.env.WORKBENCH_BASE_URL || "").trim();
const baseURL = externalBaseUrl || "http://localhost:5175";
const shouldManageServers = externalBaseUrl.length === 0;
const ignoreHTTPSErrors = baseURL.startsWith("https://");

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    trace: "off",
    ignoreHTTPSErrors,
  },
  globalSetup: "./tests/global-setup.mjs",
  webServer: shouldManageServers
    ? [
        {
          command: "npm run start",
          cwd: apiCwd,
          url: "http://localhost:4010/api/public/health",
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            ...process.env,
            RATE_LIMIT_MAX: "1000",
            PORT: "4010",
            CORS_ORIGIN: "http://localhost:5175",
          },
        },
        {
          command: "npm run dev -- --host 0.0.0.0 --port 5175",
          cwd: uiCwd,
          url: "http://localhost:5175",
          reuseExistingServer: false,
          env: {
            ...process.env,
            VITE_API_BASE_URL: "http://localhost:4010",
          },
          timeout: 120_000,
        },
      ]
    : undefined,
});
