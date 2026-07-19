# DB Tenant Rules

## Scope

These rules apply to V2 tenant-owned tables and to shared tables that store tenant-scoped data.

## Rules

1. Every tenant-owned table must include `tenant_id uuid not null`.
2. `tenant_id` must reference `kernel.tenants(tenant_id)` when the row belongs to a tenant-owned or tenant-scoped table.
3. Tenant-owned uniqueness must be tenant-scoped unless there is a deliberate cross-tenant business rule.
4. Tenant-scoped unique constraints should include `tenant_id` first.
5. Tenant-scoped indexes should also start with `tenant_id`.
6. Tenant-owned tables should be RLS-ready from the start.
7. RLS policies must deny by default when `app.current_tenant_id` is missing.
8. Shared control-plane tables may omit `tenant_id` only when they are truly global registry or identity tables.
9. If a shared table stores tenant membership, tenant ownership, or tenant configuration, it must carry `tenant_id` and follow the same scoping rules.
10. JSONB is allowed only for governed payloads; do not hide core tenant keys inside JSONB.

## Practical Conventions

- Keep `tenant_id` in relational columns, not inside payload JSON.
- Put `tenant_id` at the front of composite keys and indexes.
- Use comments on tables and columns to mark whether the table is tenant-owned or shared control-plane data.
- Keep cross-tenant access in explicit authorization code, not in implicit database assumptions.

## RLS-Ready Design Notes

- Use `security.current_tenant_id()` in policies.
- Apply both `USING` and `WITH CHECK` clauses to writeable tenant-owned tables.
- Deny-by-default is the target behavior for any tenant-scoped row access.
- If a table is intended to remain globally visible, document that exception explicitly.

## Examples

- Good: `UNIQUE (tenant_id, setting_key)`
- Good: `INDEX (tenant_id, setting_status)`
- Bad: global uniqueness on a tenant-owned business key without a tenant scope
- Bad: tenant isolation hidden in application code only
- Bad: storing tenant identity only inside JSONB
