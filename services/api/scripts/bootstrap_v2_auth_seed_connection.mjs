import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

function normalize(value) {
  return String(value ?? "").trim();
}

function applyPostgresUrlToEnv(rawUrl, env = process.env) {
  const source = normalize(rawUrl);
  if (!source) return false;

  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error("Railway/Postgres connection URL is invalid");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Railway/Postgres connection URL must use postgres:// or postgresql://");
  }

  if (!parsed.hostname || !parsed.username || !parsed.pathname || parsed.pathname === "/") {
    throw new Error("Railway/Postgres connection URL is missing host, user, or database");
  }

  env.PGHOST = decodeURIComponent(parsed.hostname);
  env.PGPORT = parsed.port || "5432";
  env.PGUSER = decodeURIComponent(parsed.username);
  env.PGPASSWORD = decodeURIComponent(parsed.password || "");
  env.PGDATABASE = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

  return true;
}

function resolveConnectionUrl(env = process.env) {
  return normalize(
    env.V2_BOOTSTRAP_DATABASE_URL
      || env.DATABASE_PUBLIC_URL
      || env.DATABASE_URL
  );
}

async function main() {
  const connectionUrl = resolveConnectionUrl(process.env);
  if (connectionUrl) {
    applyPostgresUrlToEnv(connectionUrl, process.env);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const seedScript = path.join(here, "bootstrap_v2_auth_seed.mjs");

  const child = spawn(process.execPath, [seedScript], {
    env: process.env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.stderr.write(`${JSON.stringify({ ok: false, error: `Auth seed terminated by ${signal}` }, null, 2)}\n`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = Number.isInteger(code) ? code : 1;
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2)}\n`);
    process.exit(1);
  });
}

export { applyPostgresUrlToEnv, resolveConnectionUrl };
