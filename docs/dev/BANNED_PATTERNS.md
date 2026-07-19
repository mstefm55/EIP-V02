# Banned Patterns

These patterns are not allowed in reviewed security-sensitive changes. If a diff introduces one of these, the change must be rewritten before merge.

## Tenant Scope

- Tenant-owned query without explicit server-side tenant scope.
- Query or mutation that depends only on client-provided tenant convenience values.
- Cross-tenant lookup handled by local feature logic instead of the shared access path.

Prefer:

- Derive tenant context on the server.
- Pass tenant scope through the shared kernel or policy layer.
- Fail closed when tenant context is missing or ambiguous.

## Authorization

- Route-level authz bypass in a handler, controller, or middleware shim.
- Feature-local `allow`, `skip`, `bypass`, or `disable` flags for authz.
- Object or role checks used as a replacement for shared policy enforcement.
- Route guard helpers that accept permission-code arguments but ignore them.

Prefer:

- Central policy evaluation.
- Shared authorization helpers.
- Deny-by-default behavior with explicit allow rules.

## Frontend Exposure

- Direct DB row or ORM record exposure to the frontend.
- Returning raw persistence objects from API handlers, loaders, or server components.
- Serializing secret material into props, initial state, or browser-visible config.

Prefer:

- Map storage rows to DTOs or view models.
- Serialize only the minimum safe surface.
- Redact or omit sensitive fields at the source.

## Secrets

- Reading non-public secret variables in client-side code.
- Passing tokens, keys, session identifiers, or credentials into frontend state.
- Logging secret values or embedding them in error payloads.

Prefer:

- Keep secret handling server-side.
- Use runtime injection only where needed.
- Redact before logging or serialization.

## External HTTP and Integration Inputs

- Using unvalidated user or tenant input to build outbound URLs, headers, or bodies.
- Trusting redirects across a trust boundary without policy.
- Sending integration requests without explicit timeout, size, and destination controls.

Prefer:

- Validate and normalize input at the boundary.
- Use allowlisted destinations and explicit timeout policy.
- Treat untrusted integration input as hostile by default.

## Page Patch Security Logic

- Patching security decisions directly in a page, component, or route shell.
- Adding one-off permission checks when a shared control already exists or should exist.
- Local overrides that silence a central security failure.

Prefer:

- Move the decision into shared kernel code.
- Keep leaf code thin and declarative.
- Add regression tests at the shared control boundary.

## UI Engine Drift

- Hardcoded surface authority lists in page shells when `/api/eip/ui/surfaces` discovery is available.
- JSX-owned workflow/process composition that should be expressed in governed surface metadata.
- Metadata values used as executable code paths (dynamic eval/function construction/component injection).
- Raw metadata-controlled asset URLs rendered directly without key-based allowlisted resolution.
- Persisting sensitive session/auth/permission/user payloads into localStorage for UI convenience.

Prefer:

- Tenant-scoped metadata discovery and composition.
- Code-owned whitelisted primitive library + metadata-owned layout/composition.
- Key-based asset registry resolution.
- Memory cache first, with sessionStorage limited to non-sensitive UI hints.
