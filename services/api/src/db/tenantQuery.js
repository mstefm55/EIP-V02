function assertTenantContext(tenantContext) {
  if (!tenantContext || !tenantContext.tenantId) {
    const error = new Error("Tenant-scoped query requires tenant context");
    error.code = "TENANT_CONTEXT_REQUIRED";
    throw error;
  }
}

function createTenantQueryPlan(sql, params = []) {
  return {
    sql,
    params,
    tenantScoped: true,
  };
}

function tenantQuery(db, tenantContext, queryFactory) {
  assertTenantContext(tenantContext);

  if (!db || typeof db.query !== "function") {
    throw new Error("Database client must expose query()");
  }

  if (typeof queryFactory !== "function") {
    throw new Error("queryFactory must be a function");
  }

  const plan = queryFactory({
    tenantContext,
    createTenantQueryPlan,
  });

  if (!plan || plan.tenantScoped !== true) {
    throw new Error("Query plan must be tenant-scoped");
  }

  return db.query(plan.sql, plan.params || []);
}

module.exports = {
  assertTenantContext,
  createTenantQueryPlan,
  tenantQuery,
};
