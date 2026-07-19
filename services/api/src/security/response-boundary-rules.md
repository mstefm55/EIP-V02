# Response Boundary Rules

## Purpose

Define what the API may emit to callers after data access and authorization have succeeded.

## Boundary rules

- Never expose raw database rows.
- Never expose secrets, tokens, credentials, session values, or signing material.
- Never expose internal-only flags, debug payloads, or unvetted metadata.
- Always emit bounded, sanitized, API-shaped data.

## Shape rules

- Use DTOs or response views, not persistence entities.
- Convert internal identifiers and schema-specific names to API contract names.
- Omit nulls and internal fields only when contract-approved.
- Preserve machine-readable errors without embedding sensitive internals.

## Safety rules

- Assume persistence objects may contain sensitive fields.
- Filter by allowlist, not blacklist, when possible.
- Treat logs, metrics, and responses as separate surfaces.
- Apply the same boundary discipline to success and error responses.

## Example expectation

Good:

```json
{
  "id": "case_001",
  "status": "open",
  "displayName": "Inbound case"
}
```

Bad:

```json
{
  "id": "case_001",
  "status": "open",
  "passwordHash": "...",
  "rawRow": {},
  "internalNotes": "..."
}
```

## Enforcement

- Response middleware
- DTO mapping layer
- Security review for privileged endpoints
