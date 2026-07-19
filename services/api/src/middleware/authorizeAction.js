function defaultPolicyCheck() {
  return { effect: "deny", reason: "POLICY_CHECK_NOT_CONFIGURED" };
}

function normalizeDecision(decision) {
  if (!decision) {
    return { effect: "deny", reason: "POLICY_DENIED" };
  }

  if (typeof decision === "string") {
    return { effect: decision === "allow" ? "allow" : "deny", reason: null };
  }

  if (typeof decision === "object") {
    return {
      effect: decision.effect === "allow" ? "allow" : "deny",
      reason: decision.reason || null,
    };
  }

  return { effect: "deny", reason: "POLICY_DENIED" };
}

function authorizeAction(options = {}) {
  const policyCheck = typeof options.policyCheck === "function" ? options.policyCheck : defaultPolicyCheck;

  return function authorizeActionMiddleware(request, response, next) {
    try {
      const tenantContext = request.tenantContext;
      const action = options.action || request.action || request.method;
      const resource = options.resource || request.resource || null;

      if (!tenantContext || !tenantContext.tenantId) {
        const error = new Error("Authorization requires tenant context");
        error.statusCode = 403;
        error.code = "AUTHZ_DENIED";
        throw error;
      }

      const decision = normalizeDecision(
        policyCheck({
          tenantContext,
          action,
          resource,
          metadata: options.metadata || null,
        })
      );

      request.authzDecision = decision;

      if (decision.effect !== "allow") {
        const error = new Error("Action denied");
        error.statusCode = 403;
        error.code = decision.reason || "AUTHZ_DENIED";
        throw error;
      }

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
  authorizeAction,
  defaultPolicyCheck,
};
