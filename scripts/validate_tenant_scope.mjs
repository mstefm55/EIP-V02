#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codeExts = new Set(['.js', '.mjs', '.cjs', '.ts']);
const serverPathPrefixes = [
  `services${path.sep}api${path.sep}src${path.sep}`,
  `services${path.sep}api${path.sep}scripts${path.sep}`,
];
const dbAccessPattern = /\b(app|client|pool|db|prisma|repo|repository)\.(query|findMany|findFirst|findUnique|queryRaw|executeRaw|updateMany|deleteMany|update|delete|insert|select)\s*\(|\b(queryRaw|executeRaw)\s*\(/i;
const sqlVerbPattern = /\b(SELECT|INSERT|UPDATE|DELETE)\b/;
const tenantScopePattern = /\b(tenantId|tenant_id|tenantScope|scopeTenant|withTenant|forTenant|tenantContext|ctx\.tenant|requestTenant|tenant\s*:\s*|orgId|accountId)\b/i;
const globallyScopedPattern = /\b(information_schema|pg_catalog|to_regclass|schema_migrations|migration)\b|select\s+1\s+as\s+ok/i;

function walk(dir) {
  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', 'out', 'vendor', 'tmp'].includes(entry.name)) {
        continue;
      }
      entries.push(...walk(path.join(dir, entry.name)));
    } else {
      entries.push(path.join(dir, entry.name));
    }
  }
  return entries;
}

function isCodeFile(relPath) {
  return codeExts.has(path.extname(relPath).toLowerCase());
}

function isServerDataAccessCandidate(relPath) {
  return serverPathPrefixes.some((prefix) => relPath.startsWith(prefix));
}

const failures = [];

for (const abs of walk(root)) {
  const rel = path.relative(root, abs);
  if (!isCodeFile(rel)) continue;
  if (!isServerDataAccessCandidate(rel)) continue;
  if (rel.startsWith(`db${path.sep}migrations${path.sep}`) || rel.startsWith(`db${path.sep}sql${path.sep}`)) {
    continue;
  }
  if (rel === path.join('services', 'api', 'scripts', 'apply_v2_migrations.mjs')) {
    continue;
  }
  if (rel.startsWith(`services${path.sep}api${path.sep}scripts${path.sep}test_`)) {
    continue;
  }
  if (rel === path.join('scripts', 'validate_tenant_scope.mjs') || rel === path.join('scripts', 'validate_security_controls.mjs')) {
    continue;
  }

  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!dbAccessPattern.test(line) && !sqlVerbPattern.test(line)) continue;

    const windowStart = Math.max(0, i - 45);
    const windowEnd = Math.min(lines.length, i + 21);
    const windowText = lines.slice(windowStart, windowEnd).join('\n');

    if (globallyScopedPattern.test(windowText)) {
      continue;
    }

    if (!tenantScopePattern.test(windowText)) {
      failures.push({
        file: rel,
        line: i + 1,
        message: 'possible tenant-owned query without explicit tenant scope',
      });
    }
  }
}

if (failures.length) {
  console.error('Tenant scope validation failed.');
  for (const failure of failures) {
    console.error(`- ${failure.file}:${failure.line} - ${failure.message}`);
  }
  process.exit(1);
}

console.log('Tenant scope validation passed.');
