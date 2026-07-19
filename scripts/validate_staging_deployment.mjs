#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  path.join("deploy", "staging", "README.md"),
  path.join("deploy", "staging", ".env.staging.example"),
  path.join("deploy", "staging", "staging_gateway.mjs"),
  path.join("deploy", "staging", "staging_stack.mjs"),
  path.join("deploy", "staging", "staging_smoke.mjs"),
  path.join("services", "api", ".env.v2.staging.example"),
  path.join("services", "api", "scripts", "apply_v2_migrations.mjs"),
  path.join("services", "api", "scripts", "seed_staging_smoke_identities.mjs"),
  path.join("apps", "workbench-ui", "tests", "run-staging-smoke.mjs"),
];

const failures = [];

for (const relPath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relPath))) {
    failures.push(`${relPath}: missing`);
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

if (failures.length === 0) {
  const gateway = read(path.join("deploy", "staging", "staging_gateway.mjs"));
  const smoke = read(path.join("deploy", "staging", "staging_smoke.mjs"));
  const runbook = read(path.join("deploy", "staging", "README.md"));
  const migrate = read(path.join("services", "api", "scripts", "apply_v2_migrations.mjs"));

  const checks = [
    ["deploy/staging/staging_gateway.mjs", gateway, "/api/"],
    ["deploy/staging/staging_gateway.mjs", gateway, "UI_BUILD_MISSING"],
    ["deploy/staging/staging_smoke.mjs", smoke, "/api/public/health"],
    ["deploy/staging/staging_smoke.mjs", smoke, "run-staging-smoke.mjs"],
    ["deploy/staging/README.md", runbook, "staging_stack.mjs"],
    ["deploy/staging/README.md", runbook, "apply_v2_migrations.mjs"],
    ["services/api/scripts/apply_v2_migrations.mjs", migrate, "pg_advisory_lock"],
  ];

  for (const [name, text, phrase] of checks) {
    if (!text.includes(phrase)) {
      failures.push(`${name}: missing required phrase ${phrase}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Staging deployment validation failed.");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Staging deployment validation passed.");
