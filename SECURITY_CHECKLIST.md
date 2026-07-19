# Security Checklist

Use this checklist for any change that touches auth, authz, tenant scope, secrets, frontend rendering, external HTTP, logging, or storage access.

## Change Triage

- [ ] This change is not security-sensitive.
- [ ] This change is security-sensitive and has been labeled or routed for security review.
- [ ] If the change is tenant-sensitive, the tenant scope is derived server-side and not from client convenience values.
- [ ] If the change touches a route or handler, authorization is enforced through the shared policy layer.
- [ ] If the change touches a page or client component, no security logic is being patched locally instead of in the shared kernel.
- [ ] If the change exposes data to the frontend, only DTOs or view models are returned.
- [ ] If the change uses outbound HTTP or integration inputs, the input validation and destination allowlist are explicit.
- [ ] If the change touches secrets, nothing secret can reach a client bundle, page prop, log, or response body.

## Required Evidence

- [ ] Positive-path tests exist for the intended behavior.
- [ ] Negative-path tests exist for the blocked or denied behavior.
- [ ] The change passes `scripts/validate_security_controls.mjs`.
- [ ] The change passes `scripts/validate_tenant_scope.mjs` if it touches tenant-owned data access.
- [ ] The change passes `scripts/validate_process_governance.mjs` if it touches process/effect/document governance.
- [ ] The change does not introduce any item listed in `docs/dev/BANNED_PATTERNS.md`.
- [ ] Any exception is documented with an owner and expiry.

## Tenant and Authorization Gates

- [ ] Every tenant-owned query carries tenant scope in server-side code.
- [ ] No query, mutation, or side effect crosses a tenant boundary without explicit policy.
- [ ] No route-level authz bypass was added to work around shared policy.
- [ ] No leaf feature reimplemented policy that already belongs in the shared kernel.
- [ ] Route guards pass explicit permission-code arrays into centralized `app.requirePermission(...)`; no placeholder/ignored permission arguments remain.
- [ ] Required permissions fail closed when identity permission metadata is missing or mismatched.

## Data Exposure Gates

- [ ] No raw DB row or ORM record is returned directly to the frontend.
- [ ] No response, props object, or serialized state contains secret material.
- [ ] Any sensitive field is redacted or omitted at the source.

## External Input Gates

- [ ] External HTTP inputs are validated before URL, header, or body construction.
- [ ] Unsafe redirects are blocked or scoped by policy.
- [ ] Logging and telemetry paths do not leak secrets or tenant data.

## Merge Decision

- [ ] All required gates passed.
- [ ] No unresolved security finding remains.
- [ ] The change can merge.
