# Authorization Shell

## Purpose

Define the central authorization shell used by the API layer before privileged access or side effects occur.

## Default policy

- Deny by default.
- Allow only when a policy hook explicitly approves the action.
- Never infer access from route presence, role labels alone, or frontend gating.

## Required inputs

- Resolved tenant context
- Requested action
- Target resource or resource reference
- Optional policy metadata

## Policy hook contract

The shell should delegate to a single policy hook, for example:

```js
policyCheck({ tenantContext, action, resource, metadata })
```

The hook must return one of:

- `allow`
- `deny`
- a structured decision object with a reason code

## Current V2 enforcement baseline

- Route guards call centralized `app.requirePermission(...)` before process/workbench access.
- Permission codes are resolved from `eip_auth.auth_identity.attrs.permissions` (governed metadata).
- Required permission arrays are enforced as explicit any-of checks.
- Missing permission metadata denies access (fail-closed).

## Enforcement rules

- Run authorization before data access.
- Run authorization before side effects.
- Run authorization independently from tenant resolution.
- Record the decision outcome in an auditable form without leaking sensitive payloads.

## Failure mode

- Missing policy hook equals deny.
- Unknown action equals deny.
- Missing tenant context equals deny.
- Missing resource context for a protected operation equals deny.

## Non-goals

- This shell does not implement policy logic.
- This shell does not define role hierarchies.
- This shell does not replace object-level checks.
