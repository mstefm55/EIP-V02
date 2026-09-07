const CONNECTION_TAXONOMY_CODES = Object.freeze([
  "CONNECTION_KIND",
  "CONNECTION_DIRECTION",
  "CONNECTION_ENVIRONMENT",
  "CONNECTION_VERIFICATION_MODE",
  "CONNECTION_AUTH_MODE",
  "CONNECTION_CHANNEL",
  "CONNECTION_MAPPING_MODE",
  "CONNECTION_HTTP_METHOD",
  "CONNECTION_LOG_LEVEL",
  "CONNECTION_SECRET_KIND",
]);

function normalizeTaxonomyRow(row) {
  return {
    code: row.code,
    label: row.label,
    sort_order: Number(row.sort_order) || 0,
    attrs: row.attrs && typeof row.attrs === "object" ? row.attrs : {},
  };
}

async function loadConnectionTaxonomy(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("Connection taxonomy requires a database query interface.");
  }

  const result = await db.query(
    `
    SELECT dl.code AS list_code,
           dv.code,
           dv.label,
           dv.sort_order,
           dv.attrs
    FROM eip_core.dropdown_list dl
    JOIN eip_core.dropdown_value dv ON dv.list_id = dl.id
    WHERE dl.tenant_id IS NULL
      AND dl.module = 'integration'
      AND dl.code = ANY($1::text[])
      AND dl.is_active = true
      AND dv.is_active = true
      AND dl.version = (
        SELECT max(dl2.version)
        FROM eip_core.dropdown_list dl2
        WHERE dl2.tenant_id IS NULL
          AND dl2.module = dl.module
          AND dl2.code = dl.code
          AND dl2.is_active = true
      )
    ORDER BY dl.code, dv.sort_order, dv.code
    `,
    [CONNECTION_TAXONOMY_CODES]
  );

  const taxonomy = Object.fromEntries(CONNECTION_TAXONOMY_CODES.map((code) => [code, []]));
  for (const row of result.rows) {
    if (!taxonomy[row.list_code]) continue;
    taxonomy[row.list_code].push(normalizeTaxonomyRow(row));
  }
  return taxonomy;
}

function publicConnectionTaxonomy(taxonomy) {
  const output = {};
  for (const code of CONNECTION_TAXONOMY_CODES) {
    output[code] = (Array.isArray(taxonomy?.[code]) ? taxonomy[code] : []).map((entry) => ({
      code: entry.code,
      label: entry.label,
      sort_order: entry.sort_order,
      attrs: entry.attrs && typeof entry.attrs === "object" ? entry.attrs : {},
    }));
  }
  return output;
}

export {
  CONNECTION_TAXONOMY_CODES,
  loadConnectionTaxonomy,
  publicConnectionTaxonomy,
};
