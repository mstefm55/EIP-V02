# Security Control Framework

This framework defines how the V2 foundation translates security intent into implementation and release decisions.

## Scope

Applies to all shared kernel code, API surfaces, jobs, integrations, storage access, and client-facing rendering that can affect:

- authentication
- authorization
- session management
- CSRF defense
- secrets handling
- tenant isolation
- XSS and injection risk
- outbound HTTP behavior
- logging and telemetry
- dependency and supply-chain hygiene
- page-level or route-level code that could otherwise bypass shared controls

## Framework Rules

### Rule 1: Security by Default

Shared code must enforce secure behavior without requiring individual consumers to remember to opt in.

### Rule 2: Fail Closed

If security context is missing, invalid, ambiguous, or inconsistent, the operation must fail rather than guess.

### Rule 3: Central Enforcement

Sensitive behavior must be enforced in shared infrastructure or a canonical policy layer, not duplicated in leaf features.

### Rule 4: Evidence First

Every control must have a verification method. If there is no test, check, or inspectable signal, the control is not complete.

### Rule 5: Tenant Boundaries Are First-Class

Tenant scoping must be explicit in request processing, data access, job execution, caching, and logging.

### Rule 6: No Silent Exceptions

Any exception to a control must be documented, reviewed, time-bound, and visible in the release gate.

### Rule 7: Shared Kernel Owns Security Decisions

Security-sensitive logic belongs in shared kernel controls or canonical policy/services, not in page patches, route-local conditions, or feature-specific overrides.

### Rule 8: Mechanized Gatekeeping

Security controls are not complete unless they are backed by validation scripts, a no-merge checklist, and CI wiring that can block regressions.

## Control Domains

### Authentication

- Use a shared authentication flow.
- Use adaptive password hashing and support MFA for privileged access.
- Prevent account enumeration.
- Rate limit auth-related abuse.

### Authorization

- Use deny-by-default policy evaluation.
- Check authorization before data access and side effects.
- Enforce tenant-scoped permissions separately from global privileges.
- Do not add route-local allow/deny logic that bypasses the central policy layer.

### Sessions

- Issue opaque, rotating, secure sessions.
- Expire sessions by idle and absolute lifetime policy.
- Invalidate sessions on logout and sensitive changes.

### CSRF

- Require CSRF defense for cookie-authenticated unsafe requests.
- Bind token validation to session state.
- Do not treat same-site cookies as the only protection.

### Secrets

- Never commit secrets.
- Load secrets from controlled runtime sources.
- Redact secret values from logs, traces, and errors.
- Never send secret material to client bundles, page props, or frontend configuration objects.

### Tenant Isolation

- Require explicit tenant context.
- Reject unverified or inferred tenant context.
- Namespace data access, caches, and side effects by tenant.
- Require tenant scope on every tenant-owned query before the query executes.
- Project frontend data through DTOs or view models; never expose raw DB rows or ORM records directly.

### XSS and Injection

- Escape output by default.
- Sanitize controlled rich text.
- Parameterize database access.
- Validate all dangerous sinks through allowlists and centralized helpers.

### External HTTP

- Allowlist destinations.
- Enforce timeout, size, and retry policy.
- Block SSRF-prone destinations and uncontrolled redirects.
- Validate untrusted integration inputs before building URLs, headers, or bodies.

### Logging and Audit

- Emit structured logs.
- Redact secrets and sensitive identifiers.
- Capture audit events for security-relevant actions.

### Dependency Hygiene

- Scan dependencies regularly.
- Block unresolved high-severity findings.
- Review new dependencies for necessity, license, and provenance.

## Drift-Control Mechanisms

The following controls are the first line of defense against security drift:

- `docs/dev/BANNED_PATTERNS.md` captures the patterns that should not appear in reviewed changes.
- `docs/dev/NO_MERGE_GATES.md` defines the hard blockers for tenant and security-sensitive diffs.
- `scripts/validate_security_controls.mjs` verifies the governance documents and catches broad security regressions.
- `scripts/validate_tenant_scope.mjs` looks for tenant-scope omissions in code paths that touch data access.
- `scripts/validate_process_governance.mjs` catches process/effect/document governance drift (macro authority, governed effect catalog, governed document metadata).
- `.github/workflows/v2-security-governance-gates.yml` wires the checks into CI.

## Required Implementation Artifacts

Each security domain must have, at minimum:

- a shared implementation point
- positive-path tests
- negative-path tests
- operational evidence or runtime verification
- a release gate condition
- a validation path that can fail the merge before release

## Release Gate Model

### Gate A - Design Approval

Pass only when:

- the control scope is documented
- the implementation approach is consistent with the shared kernel
- the test strategy exists

### Gate B - Implementation Approval

Pass only when:

- the control is implemented in the shared path
- regression tests pass
- no new bypass is introduced
- no banned pattern is introduced in the diff or surrounding path

### Gate C - Release Approval

Pass only when:

- required evidence is attached
- no critical or high unresolved security issue remains
- any exception has explicit owner and expiry
- the validation scripts and no-merge gates have been executed for security-sensitive changes

## Verification Matrix

| Domain | Primary Verification | Secondary Verification | Release Signal |
| --- | --- | --- | --- |
| Authentication | unit + integration tests | manual review of failure semantics | auth test report |
| Authorization | policy tests | negative access tests | deny-by-default evidence |
| Sessions | lifecycle tests | cookie inspection | session policy sign-off |
| CSRF | unsafe-method tests | browser/client verification | CSRF pass report |
| Secrets | secret scan | runtime redaction checks | clean scan result |
| Tenant Isolation | cross-tenant tests | request context assertions | tenant isolation pass |
| XSS / Injection | sink-specific tests | static review of dangerous APIs | exploit regression suite |
| External HTTP | integration tests | allowlist review | outbound safety report |
| Logging | redaction tests | audit schema review | audit/log validation |
| Dependencies | scanner output | license/provenance review | dependency gate report |

## Exception Handling

Exceptions are allowed only when all of the following are true:

- the exception is documented
- the impact is understood
- an owner is assigned
- the exception has an expiry or review date
- the release gate knows how to detect the exception

## Completion Standard

The framework is complete when it is possible to:

- identify the required control for any security-sensitive path
- verify the control with tests or inspection
- block a release when the control regresses
- explain any exception without relying on tribal knowledge
