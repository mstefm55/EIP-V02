import { spawnSync } from "node:child_process";

const checks = [
  {
    name: "api_unit_tests",
    args: ["test", "--silent"],
  },
  {
    name: "auth_security_flow",
    args: ["run", "test:auth:security"],
  },
  {
    name: "prod_dependency_audit",
    args: ["run", "audit:prod"],
  },
];

function quoteArg(arg) {
  const value = String(arg ?? "");
  if (value === "") return "\"\"";
  if (!/[ \t"\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function runNpm(args) {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "cmd.exe";
    const npmCmd = `npm ${args.map((entry) => quoteArg(entry)).join(" ")}`.trim();
    return spawnSync(comspec, ["/d", "/s", "/c", npmCmd], {
      stdio: "inherit",
      env: process.env,
    });
  }

  return spawnSync("npm", args, {
    stdio: "inherit",
    env: process.env,
  });
}

for (const check of checks) {
  process.stdout.write(`\n[no-downgrade] running ${check.name}...\n`);
  const result = runNpm(check.args);

  if (result.status !== 0) {
    process.stderr.write(
      `[no-downgrade] FAILED: ${check.name} (exit ${result.status ?? "unknown"})${result.error ? ` error=${result.error.message}` : ""}\n`
    );
    process.exit(result.status ?? 1);
  }
}

process.stdout.write("\n[no-downgrade] PASS: all required security checks succeeded.\n");
