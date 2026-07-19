#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codeExts = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.go', '.java', '.cs', '.rb', '.php', '.rs', '.kt', '.scala', '.sql']);
const clientPathHints = ['client', 'frontend', 'web', 'ui', 'pages', 'components', 'screens', 'app'];

const requiredFiles = [
  'SECURITY_TARGET.md',
  'SECURITY_CHECKLIST.md',
  path.join('docs', 'architecture', 'SECURITY_CONTROL_FRAMEWORK.md'),
  path.join('docs', 'dev', 'BANNED_PATTERNS.md'),
  path.join('docs', 'dev', 'NO_MERGE_GATES.md'),
  path.join('scripts', 'validate_security_controls.mjs'),
  path.join('scripts', 'validate_tenant_scope.mjs'),
  path.join('scripts', 'validate_process_governance.mjs'),
  path.join('.github', 'workflows', 'v2-security-governance-gates.yml'),
  path.join('services', 'api', 'src', 'security', 'permissionPolicy.js'),
];

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

function readText(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function hasClientHint(relPath) {
  const normalized = relPath.split(path.sep).join('/').toLowerCase();
  return clientPathHints.some((hint) => normalized.includes(`/${hint}/`) || normalized.startsWith(`${hint}/`) || normalized.includes(`/${hint}.`));
}

function isCodeFile(relPath) {
  return codeExts.has(path.extname(relPath).toLowerCase());
}

const failures = [];

for (const rel of requiredFiles) {
  if (!fs.existsSync(path.join(root, rel))) {
    failures.push({ file: rel, line: 1, message: 'required governance file is missing' });
  }
}

if (failures.length === 0) {
  const target = readText('SECURITY_TARGET.md');
  const framework = readText(path.join('docs', 'architecture', 'SECURITY_CONTROL_FRAMEWORK.md'));
  const checklist = readText('SECURITY_CHECKLIST.md');
  const banned = readText(path.join('docs', 'dev', 'BANNED_PATTERNS.md'));
  const gates = readText(path.join('docs', 'dev', 'NO_MERGE_GATES.md'));
  const processRoute = readText(path.join('services', 'api', 'src', 'routes', 'process', 'core_process.js'));
  const authShell = readText(path.join('services', 'api', 'src', 'plugins', 'authShell.js'));

  const requiredPhrases = [
    ['SECURITY_TARGET.md', target, [
      'no-merge gates',
      'tenant scope',
      'authz',
      'frontend exposure',
      'external inputs',
    ]],
    ['SECURITY_CONTROL_FRAMEWORK.md', framework, [
      'Shared Kernel Owns Security Decisions',
      'Mechanized Gatekeeping',
      'BANNED_PATTERNS.md',
      'NO_MERGE_GATES.md',
    ]],
    ['SECURITY_CHECKLIST.md', checklist, [
      'validate_security_controls.mjs',
      'validate_tenant_scope.mjs',
      'BANNED_PATTERNS.md',
    ]],
    ['BANNED_PATTERNS.md', banned, [
      'Tenant Scope',
      'Authorization',
      'Frontend Exposure',
      'Secrets',
      'External HTTP and Integration Inputs',
      'Page Patch Security Logic',
    ]],
    ['NO_MERGE_GATES.md', gates, [
      'Hard Blockers',
      'Required Merge Evidence',
      'Escalation Rule',
      'validate_process_governance.mjs',
    ]],
  ];

  for (const [file, text, phrases] of requiredPhrases) {
    for (const phrase of phrases) {
      if (!text.includes(phrase)) {
        failures.push({ file, line: 1, message: `missing expected guidance phrase: ${phrase}` });
      }
    }
  }

  if (/\basync function requirePerm\(app,\s*req,\s*reply,\s*_permCodes\)/.test(processRoute)) {
    failures.push({
      file: path.join('services', 'api', 'src', 'routes', 'process', 'core_process.js'),
      line: 1,
      message: 'requirePerm must not ignore passed permission codes',
    });
  }

  if (!processRoute.includes('app.requirePermission(')) {
    failures.push({
      file: path.join('services', 'api', 'src', 'routes', 'process', 'core_process.js'),
      line: 1,
      message: 'process routes must enforce permission codes through app.requirePermission',
    });
  }

  if (!authShell.includes('decorate("requirePermission"')) {
    failures.push({
      file: path.join('services', 'api', 'src', 'plugins', 'authShell.js'),
      line: 1,
      message: 'auth shell must expose centralized requirePermission decorator',
    });
  }
}

const authBypassPattern = /\b(skipAuth|bypassAuth|allowAnonymous|permitAll|disableAuth|disableAuthorization)\b|\b(authz|authorize)\s*:\s*false\b/i;
const secretLeakPattern = /process\.env\.(?!NEXT_PUBLIC_|PUBLIC_|VITE_|REACT_APP_)[A-Z0-9_]+/;
const rawRowExposurePattern = /\b(res|response)\.(json|send|end)\s*\(\s*(rows?|row|result|record|records|data)\s*\)|\breturn\s+(rows?|row|result|record|records)\b/i;
const dbAccessPattern = /\b(db|prisma|sql|query|repository|repo)\b|\b(findMany|findFirst|findUnique|queryRaw|executeRaw|update|delete|insert|select)\b/i;

for (const abs of walk(root)) {
  const rel = path.relative(root, abs);
  if (!isCodeFile(rel)) continue;
  if (rel === path.join('scripts', 'validate_security_controls.mjs') || rel === path.join('scripts', 'validate_tenant_scope.mjs')) {
    continue;
  }

  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/);
  const isClientish = hasClientHint(rel);

  lines.forEach((line, idx) => {
    if (authBypassPattern.test(line)) {
      failures.push({ file: rel, line: idx + 1, message: 'authz bypass marker is banned; use shared authorization controls' });
    }
    if (isClientish && secretLeakPattern.test(line)) {
      failures.push({ file: rel, line: idx + 1, message: 'non-public env var referenced in client-facing path' });
    }
  });

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!dbAccessPattern.test(line)) continue;
    const windowStart = Math.max(0, i - 4);
    const windowEnd = Math.min(lines.length, i + 5);
    const windowText = lines.slice(windowStart, windowEnd).join('\n');
    if (rawRowExposurePattern.test(windowText) && !/tenant/i.test(windowText)) {
      failures.push({
        file: rel,
        line: i + 1,
        message: 'possible raw DB row exposure to frontend; project to DTOs and redact at the source',
      });
    }
  }
}

if (failures.length) {
  console.error('Security control validation failed.');
  for (const failure of failures) {
    console.error(`- ${failure.file}:${failure.line} - ${failure.message}`);
  }
  process.exit(1);
}

console.log('Security control validation passed.');
