# API to DB Mapping Rules

## Purpose

Define how API inputs become database operations without leaking tenant boundaries or internal schema details.

## Mapping principles

- Map API requests to governed persistence operations, not raw ad hoc SQL.
- Keep the mapping layer explicit and testable.
- Use tenant context as a required input to every persistence path.
- Treat DB access as an internal implementation detail.

## Required rules

- Every tenant-bound read or write must include a tenant scope.
- Query builders must reject plans that are not tenant-scoped.
- API field names may differ from DB field names, but the mapping must be documented in code or metadata.
- API handlers must not pass client data directly into SQL fragments.
- Any dynamic query fragment must come from an allowlisted builder.

## Response mapping

- Convert DB rows into API DTOs before response emission.
- Strip internal IDs, secret material, and operational metadata unless explicitly approved.
- Do not return raw persistence objects to the frontend.

## Query shape expectations

- `where` clauses must include tenant scope for tenant-owned records.
- Mutations must write the resolved tenant identifier from server context.
- Cross-tenant joins require explicit governance and review.

## Allowed transformations

- Renaming fields
- Type normalization
- Denormalizing safe display data
- Aggregating governed metrics

## Disallowed transformations

- String concatenation into SQL from request input
- Client-controlled tenant selection
- Returning ORM entities directly
- Returning raw JSONB blobs when a governed DTO is expected

## Enforcement

- Middleware resolves context
- Helper constructs scoped query plans
- Authorization checks gate the operation
- Response boundary strips any internal-only fields
