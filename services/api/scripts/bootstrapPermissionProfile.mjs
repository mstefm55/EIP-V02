const DEFAULT_BOOTSTRAP_PERMISSION_CODES = Object.freeze([
  "OWNER_ADMIN_CONSOLE_READ",
  "OWNER_ADMIN_ACCESS_READ",
  "OWNER_ADMIN_ACCESS_WRITE",
  "OWNER_ADMIN_SECURITY_READ",
  "OWNER_ADMIN_SECURITY_WRITE",
  "OWNER_ADMIN_SETTINGS_READ",
  "OWNER_ADMIN_SETTINGS_WRITE",
  "OWNER_ADMIN_AUDIT_READ",
  "OWNER_ADMIN_SCHEMA_READ",
  "OWNER_ADMIN_CONNECTION_READ",
  "OWNER_ADMIN_CONNECTION_WRITE",
  "OWNER_ADMIN_CONNECTION_SECRET_MANAGE",
  "OWNER_ADMIN_CONNECTION_TEST",
  "PROCESS_DEF_READ",
  "CRM_PROCESS_DEF_READ",
  "PROCESS_DEF_WRITE",
  "CRM_PROCESS_DEF_WRITE",
  "PROCESS_INSTANCE_READ",
  "PROCESS_INSTANCE_WRITE",
]);

const PLATFORM_CONTROL_PERMISSION_CODES = Object.freeze([
  "PLATFORM_TENANT_REQUEST_READ",
  "PLATFORM_TENANT_REQUEST_WRITE",
]);

const LEGACY_PLATFORM_PERMISSION_CODES = Object.freeze([
  "OWNER_ADMIN_TENANT_REQUEST_READ",
  "OWNER_ADMIN_TENANT_REQUEST_WRITE",
]);

function normalizePermissionCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  return code || null;
}

function normalizePermissionCodes(values) {
  const source = Array.isArray(values) ? values : [];
  const seen = new Set();
  const output = [];

  for (const value of source) {
    const code = normalizePermissionCode(value);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    output.push(code);
  }

  return output;
}

function buildOwnerAdminPermissionCodes(existingPermissions, { includePlatformControl = false } = {}) {
  const restricted = new Set([
    ...LEGACY_PLATFORM_PERMISSION_CODES,
    ...PLATFORM_CONTROL_PERMISSION_CODES,
  ]);
  const preserved = normalizePermissionCodes(existingPermissions)
    .filter((code) => !restricted.has(code));
  const required = includePlatformControl
    ? [...DEFAULT_BOOTSTRAP_PERMISSION_CODES, ...PLATFORM_CONTROL_PERMISSION_CODES]
    : DEFAULT_BOOTSTRAP_PERMISSION_CODES;

  return normalizePermissionCodes([...preserved, ...required]);
}

function mergeBootstrapPermissionCodes(existingPermissions, requiredPermissions = DEFAULT_BOOTSTRAP_PERMISSION_CODES) {
  const restricted = new Set([
    ...LEGACY_PLATFORM_PERMISSION_CODES,
    ...PLATFORM_CONTROL_PERMISSION_CODES,
  ]);
  return normalizePermissionCodes([
    ...normalizePermissionCodes(existingPermissions).filter((code) => !restricted.has(code)),
    ...(Array.isArray(requiredPermissions) ? requiredPermissions : []),
  ]);
}

export {
  DEFAULT_BOOTSTRAP_PERMISSION_CODES,
  PLATFORM_CONTROL_PERMISSION_CODES,
  LEGACY_PLATFORM_PERMISSION_CODES,
  buildOwnerAdminPermissionCodes,
  mergeBootstrapPermissionCodes,
  normalizePermissionCode,
  normalizePermissionCodes,
};
