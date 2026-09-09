function normalizeTenantCode(value) {
  return String(value ?? "").trim();
}

function toTargetTenantDto(row) {
  return {
    id: row?.tenant_id || null,
    code: row?.tenant_code || null,
    name: row?.tenant_name || row?.tenant_code || null,
    status: row?.tenant_status || null,
    tenancy_mode: row?.tenancy_mode || null,
  };
}

async function listConnectionTargetTenants(pool) {
  const result = await pool.query(
    `
    SELECT tenant_id, tenant_code, tenant_name, tenant_status, tenancy_mode
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
    SELECT tenant_id, tenant_code, tenant_name, tenant_status, tenancy_mode
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
