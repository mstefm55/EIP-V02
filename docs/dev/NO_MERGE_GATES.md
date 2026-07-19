# No-Merge Gates

These are hard blockers for tenant-sensitive and security-sensitive changes.

## Hard Blockers

- A tenant-owned query does not carry explicit server-side tenant scope.
- A route, middleware, or handler bypasses shared authorization control.
- A route guard accepts permission codes but does not enforce them.
- Raw DB rows or ORM records are exposed directly to the frontend.
- Secret material can reach a client bundle, page prop, response body, or log.
- External HTTP or integration inputs are not validated before use.
- Security logic is patched locally in a page or route instead of being moved into shared kernel code.
- Process transitions reintroduce inline transition effects instead of governed `macro_code`.
- Effect alias/canonical authority is hardcoded in JS instead of governed metadata.
- Document category/header semantics are hardcoded outside governed metadata lists.
- UI surface switching/composition authority is hardcoded in page JSX instead of governed metadata + UI engine contracts.
- UI metadata is not tenant/realm scoped in discovery/load paths.
- UI metadata is treated as executable code or uncontrolled runtime injection.
- UI caches store sensitive auth/session/permission payloads in localStorage.
- A new security-sensitive path has no positive and negative tests.
- The diff introduces a pattern listed in `docs/dev/BANNED_PATTERNS.md`.
- The change depends on an undocumented exception or an exception without owner and expiry.

## Required Merge Evidence

- The shared control path is visible in the diff or already exists and is reused.
- The tenant/security-sensitive path is covered by tests.
- The validation scripts pass.
- `scripts/validate_process_governance.mjs` passes when process/effect/document governance is touched.
- Frontend smoke includes tenant-scoped surface discovery and engine-rendered workbench flow when UI engine paths are touched.
- The reviewer can identify the control owner and the release gate.

## Escalation Rule

If any hard blocker is present, do not merge the change as-is. Rewrite the implementation, or add a documented exception with owner, expiry, and review criteria before proceeding.
