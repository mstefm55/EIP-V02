const LEGACY_TENANT_REQUEST_PERMISSION_CODES = new Set([
  "OWNER_ADMIN_TENANT_REQUEST_READ",
  "OWNER_ADMIN_TENANT_REQUEST_WRITE",
]);

const PLATFORM_PERMISSION_ALIASES = Object.freeze({
  PLATFORM_TENANT_REQUEST_READ: "OWNER_ADMIN_TENANT_REQUEST_READ",
  PLATFORM_TENANT_REQUEST_WRITE: "OWNER_ADMIN_TENANT_REQUEST_WRITE",
});

function normalizePermissionCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  return code.length > 0 ? code : null;
}

function normalizePermissionCodes(values) {
  if (!Array.isArray(values)) return [];

  const output = [];
  const seen = new Set();
  for (const value of values) {
    const code = normalizePermissionCode(value);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    output.push(code);
  }
  return output;
}

function extractPermissionCodes(identityAttrs) {
  const attrs = identityAttrs && typeof identityAttrs === "object" ? identityAttrs : {};
  const buckets = [
    attrs.permissions,
    attrs.permission_codes,
    attrs.permissionCodes,
    attrs.authz?.permissions,
    attrs.auth?.permissions,
  ];

  const collected = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    collected.push(...bucket);
  }

  const declared = normalizePermissionCodes(collected);
  const declaredSet = new Set(declared);
  const effective = declared.filter((code) => !LEGACY_TENANT_REQUEST_PERMISSION_CODES.has(code));

  // Tenant-request review is a global control-plane capability. Legacy
  // OWNER_ADMIN_TENANT_REQUEST_* grants are deliberately inert so a tenant
  // Owner Admin can never inherit cross-tenant onboarding authority. Explicit
  // PLATFORM_* permission codes bridge to the legacy route contract until that
  // contract can be retired without weakening migration compatibility.
  for (const [platformCode, legacyAlias] of Object.entries(PLATFORM_PERMISSION_ALIASES)) {
    if (!declaredSet.has(platformCode)) continue;
    effective.push(platformCode, legacyAlias);
  }

  return normalizePermissionCodes(effective);
}

function buildPermissionDecision({ requiredPermissions, grantedPermissions }) {
  const required = normalizePermissionCodes(requiredPermissions);
  const granted = normalizePermissionCodes(grantedPermissions);
  if (required.length === 0) {
    return {
      ok: true,
      requiredPermissions: required,
      grantedPermissions: granted,
    };
  }

  if (granted.length === 0) {
    return {
      ok: false,
      reason: "PERMISSION_REQUIRED",
      requiredPermissions: required,
      grantedPermissions: granted,
    };
  }

  const grantedSet = new Set(granted);
  const allowed = required.some((code) => grantedSet.has(code));
  if (!allowed) {
    return {
      ok: false,
      reason: "PERMISSION_REQUIRED",
      requiredPermissions: required,
      grantedPermissions: granted,
    };
  }

  return {
    ok: true,
    requiredPermissions: required,
    grantedPermissions: granted,
  };
}

export {
  LEGACY_TENANT_REQUEST_PERMISSION_CODES,
  PLATFORM_PERMISSION_ALIASES,
  normalizePermissionCode,
  normalizePermissionCodes,
  extractPermissionCodes,
  buildPermissionDecision,
};
