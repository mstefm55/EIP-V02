# Security Target State

Version: V2 foundation target

## Purpose

Define the security bar for the V2 foundation as a production-grade baseline that is measurable, enforceable, and auditable. The target is not "secure enough"; it is "best in class" for the current architecture and implementation surface.

## Target Outcome

The platform should reach a state where:

- Authentication, authorization, session handling, CSRF, secrets, tenant isolation, input handling, outbound HTTP, logging, and dependency hygiene are all governed by explicit controls.
- Security behavior is enforced by default in shared kernel code, not left to screen-specific or tenant-specific implementations.
- Security-sensitive changes are classified early and blocked by no-merge gates when they touch tenant scope, authz, secrets, frontend exposure, or external inputs.
- Every control has an owner, a verification method, and a release gate.
- Failures are observable, reproducible, and blocked before production.

## 10/10 Control Standard

### 1. Authentication

- All interactive access requires strong authentication.
- Password storage uses a modern adaptive password hash with per-user salt and tuned work factors.
- MFA is supported for privileged users and can be required by policy.
- Login, password reset, session renewal, and privileged actions are rate-limited and abuse-aware.
- Authentication responses do not reveal whether a username, email, or tenant exists.
- Account recovery flows are time-bound, single-use, and invalidated on reuse or password change.
- Service-to-service authentication uses scoped machine credentials or signed assertions, never shared human sessions.

Evidence:

- Threat model for login and recovery flows.
- Unit and integration tests for failure messages, lockout thresholds, token replay, and MFA enforcement.
- Configuration record for password policy and MFA policy.

### 2. Authorization

- Authorization is deny-by-default.
- Every protected operation is checked server-side before data access and before side effects.
- Tenant-scoped permissions are enforced independently from global permissions.
- Role checks are insufficient on their own; object-, tenant-, and action-level checks must be explicit where relevant.
- Shared route guards must call centralized permission enforcement (for V2 API: `app.requirePermission(...)`) and pass explicit permission codes.
- Missing or mismatched permission metadata must fail closed (`403`) rather than degrade to session-only access.
- Ad hoc route-level authorization bypasses are prohibited; route handlers must call the shared policy layer or a canonical authorization helper.
- Privileged actions require step-up authorization when risk is elevated.
- Authorization decisions are logged in an auditable form without exposing sensitive payloads.

Evidence:

- Central policy tests covering allowed and denied cases.
- Guard tests proving permission-code arrays are enforced and not ignored by route guards.
- Negative tests for privilege escalation, cross-tenant access, and broken object scoping.
- Traceable policy metadata for each privileged endpoint or command.

### 3. Session Security

- Sessions are cryptographically strong, opaque, and rotated after authentication and privilege changes.
- Session cookies are `HttpOnly`, `Secure`, and use `SameSite` settings appropriate to the flow.
- Session fixation is prevented.
- Concurrent session behavior is defined and enforced.
- Idle and absolute session lifetimes are set by policy.
- Logout invalidates the active session and any linked refresh state.
- Device trust or remembered-device behavior is explicit, revocable, and bounded.

Evidence:

- Session lifecycle tests for creation, rotation, expiration, logout, and replay.
- Cookie attribute verification in automated tests.
- Admin policy record for session lifetime settings.

### 4. CSRF Protection

- State-changing browser requests require CSRF defenses unless the request is explicitly non-cookie authenticated and safe by design.
- CSRF tokens are bound to session state and rotated according to policy.
- Unsafe methods are rejected without a valid anti-CSRF signal.
- Same-site protections are not treated as the only defense.
- CORS settings are not used as a replacement for CSRF protection.

Evidence:

- Tests covering unsafe methods with missing, invalid, and replayed tokens.
- Verification that cookie-authenticated endpoints require CSRF protection.

### 5. Secrets Management

- Secrets are never committed to source control.
- Secrets are loaded from controlled runtime sources and injected only where needed.
- Secret scopes are minimized and rotated on a defined schedule.
- Credentials are separated by environment, tenant boundary, and service boundary where applicable.
- Secret material is never written to logs, metrics labels, crash dumps, or frontend payloads.
- Secret material is never serialized into client bundles, page props, initial state, or frontend configuration objects.
- Secret rotation procedures exist and are tested for operational feasibility.

Evidence:

- Secret scanning in CI and pre-merge checks.
- Runtime redaction tests.
- Rotation runbook and periodic verification.

### 6. Tenant Isolation

- Tenant context is explicit and cannot be inferred from client-provided convenience values alone.
- Every tenant-bound query, mutation, and external side effect is scoped server-side.
- Tenant-owned queries must carry server-derived tenant scope; missing tenant scope is a hard failure.
- Cross-tenant access is impossible by default and must fail closed.
- Shared infrastructure may exist, but data and authorization boundaries are enforced per tenant.
- Tenant identifiers are validated and never trusted from unverified headers, query strings, or local state.
- Frontend payloads receive DTOs or view models only; raw database rows and ORM records are not exposed directly to the client.

Evidence:

- Cross-tenant access tests at API and persistence layers.
- Tenant-bound request context assertions.
- Detections for missing tenant context in protected paths.

### 7. XSS Protection

- HTML output is escaped by default.
- Rich text, markdown, and user-generated content use explicit allowlists and sanitization rules.
- Dangerous sinks are centrally controlled.
- CSP is applied where the delivery model supports it.
- Inline script injection is avoided unless explicitly governed and nonce-based.
- Frontend components do not concatenate untrusted HTML into executable contexts.

Evidence:

- Sanitization tests for stored and reflected content.
- CSP verification in browser-facing surfaces.
- Sink inventory for any permitted unsafe rendering.

### 8. Injection Defense

- Parameterized access is required for database operations.
- Dynamic query fragments are allowed only through vetted builders and allowlists.
- Shell, template, command, and path handling are never formed by naive string concatenation from user input.
- Deserialization and expression evaluation are gated and restricted.
- File names, MIME types, and paths are validated against policy before use.

Evidence:

- Static checks for dangerous API usage.
- Tests for SQL injection, command injection, template injection, and path traversal regressions.
- Allowlist review for any dynamic fragment mechanism.

### 9. External HTTP Safety

- Outbound HTTP requests require explicit allowlists, timeouts, retries, and size limits.
- Redirects are controlled and not blindly followed across trust boundaries.
- SSRF-resistant validation is applied to host, scheme, and destination policy.
- External integration inputs are validated at the boundary before URLs, headers, or payloads are constructed.
- Request and response bodies are bounded and sanitized before logging.
- Third-party failures degrade safely and do not leak secrets or tenant data.

Evidence:

- Integration tests for timeout, redirect, and blocked destination behavior.
- Allowlist and policy review for each outbound integration.
- Metrics for retry, latency, and failure classification.

### 10. Logging, Audit, and Telemetry

- Logs are structured, machine-readable, and consistent.
- Security events are auditable and include actor, tenant, action, result, and correlation identifiers.
- Sensitive values are redacted at the source.
- Logs do not contain passwords, tokens, session identifiers, keys, or raw PII unless explicitly approved and masked.
- Security-relevant actions are retained long enough for incident response and review.

Evidence:

- Redaction tests and sample log validation.
- Audit event schema review.
- Retention policy definition and verification.

### 11. Dependency Hygiene and Supply Chain

- Dependencies are pinned or controlled by policy.
- Vulnerability scanning is part of the merge gate.
- New dependencies require justification, license review, and security review.
- Build artifacts are reproducible enough to identify what shipped.
- Updates are applied on a regular cadence rather than deferred indefinitely.

Evidence:

- Dependency scan results.
- License and provenance review for new packages.
- Patch cadence records and exception log.

### 12. Security Gates

- No high-severity unresolved vulnerabilities in the release candidate path.
- No secrets in tracked files, build output, or CI logs.
- No known cross-tenant access defects.
- No unsafe-by-default auth/session/CSRF settings.
- No release without security regression evidence for changed surfaces.
- No merge of tenant/security-sensitive changes without checklist completion, validation scripts, and explicit exception handling where applicable.

Evidence:

- Release checklist with explicit pass/fail status.
- Security test report attached to each release candidate.

### 13. Drift Control and Governance

- Security-sensitive controls must live in shared kernel code, not in page patches or route-local one-offs.
- The canonical guardrail inventory lives in `docs/dev/BANNED_PATTERNS.md`.
- No-merge criteria for security-sensitive changes live in `docs/dev/NO_MERGE_GATES.md`.
- The pre-merge validation entry points are `scripts/validate_security_controls.mjs` and `scripts/validate_tenant_scope.mjs`.
- CI must execute the security governance gates before merge eligibility is granted.
- Exceptions must be explicit, time-bound, and visible to review.

## Best-In-Class Operating Principles

- Default to fail closed.
- Centralize control enforcement.
- Prefer declarative policy over scattered ad hoc checks.
- Measure every sensitive behavior.
- Treat logging and observability as a security surface.
- Keep tenant isolation and authz separate even when they share metadata.
- Require evidence for exceptions.

## Definition of Done

A security control is considered complete only when all of the following are true:

- The control is documented in this file or the framework file.
- The implementation exists in the relevant module or shared service.
- Positive and negative tests exist.
- The control is enforced by default, not by convention.
- The CI or release gate can detect regression.
- Any exceptions are explicitly documented with expiration or review criteria.
