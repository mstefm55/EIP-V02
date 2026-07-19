# Tenant Context Contract

## Purpose

Define the single canonical tenant context used by the API layer before any authorization, query construction, or response shaping happens.

## Contract

Tenant context must be resolved server-side and attached to the request lifecycle as a normalized object.

### Required fields

- `tenantId`: canonical tenant identifier used for all tenant-scoped persistence
- `actorId`: authenticated actor identifier
- `roles`: resolved role list used for policy checks
- `permissions`: resolved permission list used for policy checks
- `source`: trusted resolution source, such as authenticated session or signed service context

### Optional fields

- `orgId`
- `workspaceId`
- `requestId`
- `correlationId`
- `scopes`
- `claims`

## Resolution rules

- Resolve tenant context from verified authentication state, not from raw client convenience values.
- Prefer signed session claims, verified service assertions, or server-side identity state.
- Reject requests that do not produce a complete and trusted tenant context for tenant-bound actions.
- Normalize identifiers before use.
- Preserve the resolved context immutably once attached.

## Forbidden sources

- Unverified headers
- Query-string tenant selectors
- Body parameters used as tenant selectors
- Local UI state
- Any client-provided tenant identifier that has not been authenticated and bound by the server

## Failure mode

- If tenant context is missing, incomplete, or untrusted, fail closed.
- Do not guess a tenant.
- Do not fall back to a default tenant.
- Do not continue to persistence or authorization with partial context.

## Output shape

The canonical shape should be stable and small:

```json
{
  "tenantId": "tenant_123",
  "actorId": "user_456",
  "roles": ["admin"],
  "permissions": ["case.read", "case.write"],
  "source": "session"
}
```

## Enforcement points

- Middleware resolution
- Authorization checks
- DB query scoping
- Response filtering

## Non-goals

- This contract does not define policy logic.
- This contract does not define schema details.
- This contract does not authorize access by itself.
