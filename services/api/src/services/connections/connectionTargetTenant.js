function normalizeTenantCode(value) {
  return String(value ?? "").trim();
}

function toTargetTenantDto(row) {
  return {
    id: row?.tenant_id || null,
    code: row?.tenant_code || null,
    name: row?.tenant_name || row?.tenant_code || null,
    status: row?.tenant_status || null,
    kind: row?.tenant_kind || null,
    tenancy_model: row?.tenancy_model || null,
  };
}

async function listConnectionTargetTenants(pool) {
  const result = await pool.query(
    `
    SELECT tenant_id, tenant_code, tenant_name, tenant_status, tenant_kind, tenancy_model
    FROM kernel.tenants
    WHERE tenant_status = 'active'
    ORDER BY lower(tenant_name), lower(tenant_code), tenant_id
    `
  );
  return result.rows.map(toTargetTenantDto);
}

async function resolveConnectionTargetTenant(pool, tenantCode) {
  const normalized = normalizeTenantCode(tenantCode);
  if (!normalized) return null;

  const result = await pool.query(
    `
    SELECT tenant_id, tenant_code, tenant_name, tenant_status, tenant_kind, tenancy_model
    FROM kernel.tenants
    WHERE tenant_code = $1
      AND tenant_status = 'active'
    LIMIT 2
    `,
    [normalized]
  );

  if (result.rowCount !== 1) return null;
  return toTargetTenantDto(result.rows[0]);
}

export {
  listConnectionTargetTenants,
  normalizeTenantCode,
  resolveConnectionTargetTenant,
  toTargetTenantDto,
};
