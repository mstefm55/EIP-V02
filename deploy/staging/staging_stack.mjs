import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiCwd = path.join(root, "services", "api");
const apiEntry = path.join(apiCwd, "src", "server.js");
const gatewayEntry = path.join(root, "deploy", "staging", "staging_gateway.mjs");
const apiEnvFile = String(process.env.STAGING_API_ENV_FILE || ".env.v2.staging").trim();
const gatewayEnvFile = String(process.env.STAGING_GATEWAY_ENV_FILE || path.join("deploy", "staging", ".env.staging")).trim();
let shuttingDown = false;
let api = null;
let gateway = null;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [gateway, api]) {
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  }
}

function spawnProcess(name, args, cwd) {
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    process.stdout.write(`[staging-stack] ${name} exited (code=${code ?? "null"} signal=${signal ?? "null"})\n`);
    if (!shuttingDown && (code !== 0 || signal)) {
      shutdown();
      process.exit(code && Number.isFinite(code) ? code : 1);
    }
  });

  return child;
}

api = spawnProcess(
  "api",
  [`--env-file-if-exists=${apiEnvFile}`, apiEntry],
  apiCwd
);

gateway = spawnProcess(
  "gateway",
  [`--env-file-if-exists=${gatewayEnvFile}`, gatewayEntry],
  root
);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.stdout.write(
  `[staging-stack] started api + gateway (api env: ${apiEnvFile}, gateway env: ${gatewayEnvFile})\n`
);
