function resolveTenantContext(request, options = {}) {
  const source = options.source || "session";
  const session = request && request.user ? request.user : null;
  const tenantId = session && session.tenantId ? String(session.tenantId) : null;
  const actorId = session && session.id ? String(session.id) : null;

  if (!tenantId || !actorId) {
    const error = new Error("Tenant context could not be resolved");
    error.statusCode = 401;
    error.code = "TENANT_CONTEXT_REQUIRED";
    throw error;
  }

  return Object.freeze({
    tenantId,
    actorId,
    roles: Array.isArray(session.roles) ? session.roles.slice() : [],
    permissions: Array.isArray(session.permissions) ? session.permissions.slice() : [],
    source,
  });
}

function tenantContextResolver(options = {}) {
  return function tenantContextResolverMiddleware(request, response, next) {
    try {
      const tenantContext = resolveTenantContext(request, options);
      request.tenantContext = tenantContext;
      if (typeof next === "function") {
        next();
      }
    } catch (error) {
      if (typeof next === "function") {
        next(error);
        return;
      }
      throw error;
    }
  };
}

module.exports = {
  resolveTenantContext,
  tenantContextResolver,
};
