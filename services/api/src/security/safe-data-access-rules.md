# Safe Data Access Rules

## Purpose

Define the minimum safe access pattern for persistence from the API service.

## Rules

- Every query must be tenant-scoped unless explicitly documented as global and safe.
- Every mutation must write through resolved server context.
- Do not expose raw SQL results to the frontend.
- Do not allow direct request-to-SQL passthrough.
- Use helper wrappers that require a tenant context and a scoped query plan.

## Expectations

- Query helpers must fail closed if tenant context is missing.
- Builders must verify that the query plan is marked tenant-scoped.
- DB access should be expressed through a governed mapping layer.
- Read models and write models may differ, but both must respect tenant isolation.

## Prohibited patterns

- Directly returning ORM or driver objects
- Tenant selection from unverified request values
- Cross-tenant reads without an approved governance path
- Raw SQL fragments assembled from user input

## Review checklist

- Tenant context present
- Query scope explicit
- Query plan allowlisted
- Response mapped through DTO
- Sensitive fields stripped
