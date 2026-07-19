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

  return normalizePermissionCodes(collected);
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
  normalizePermissionCode,
  normalizePermissionCodes,
  extractPermissionCodes,
  buildPermissionDecision,
};
