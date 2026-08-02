const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class TenantTransactionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "TenantTransactionError";
    this.code = code;
  }
}

function normalizeTenantId(tenantId) {
  const value = String(tenantId ?? "").trim();
  if (!value) {
    throw new TenantTransactionError("Tenant context is required.", "TENANT_CONTEXT_REQUIRED");
  }
  if (!UUID_PATTERN.test(value)) {
    throw new TenantTransactionError("Tenant context is invalid.", "TENANT_CONTEXT_INVALID");
  }
  return value.toLowerCase();
}

function assertTenantPool(pool) {
  if (!pool || typeof pool.connect !== "function") {
    throw new TenantTransactionError(
      "Tenant transaction requires a pg pool with connect().",
      "TENANT_POOL_REQUIRED"
    );
  }
}

function assertTenantCallback(callback) {
  if (typeof callback !== "function") {
    throw new TenantTransactionError(
      "Tenant transaction requires a callback.",
      "TENANT_CALLBACK_REQUIRED"
    );
  }
}

async function withTenantTransaction(pool, tenantId, callback) {
  assertTenantPool(pool);
  assertTenantCallback(callback);

  const normalizedTenantId = normalizeTenantId(tenantId);
  const client = await pool.connect();
  let transactionStarted = false;
  let transactionClosed = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
      normalizedTenantId,
    ]);

    const callbackValue = await callback(client, { tenantId: normalizedTenantId });
    await client.query("COMMIT");
    transactionClosed = true;
    return callbackValue;
  } catch (error) {
    if (transactionStarted && !transactionClosed) {
      await client.query("ROLLBACK").catch(() => undefined);
      transactionClosed = true;
    }
    throw error;
  } finally {
    client.release();
  }
}

export {
  TenantTransactionError,
  normalizeTenantId,
  withTenantTransaction,
};
